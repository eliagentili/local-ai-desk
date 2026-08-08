//! Lifecycle of the child processes started by the app.
//!
//! The engine runtime spawns its own workers (PDF translation, model warmup),
//! so terminating only the direct child leaves grandchildren behind. Every
//! process the app starts is therefore placed in a dedicated process group and
//! the whole group is terminated together: first politely, so Python can flush
//! its own cleanup, then forcefully.

use std::{
    fs,
    path::{Path, PathBuf},
    process::{Child, Command},
    sync::{Arc, Mutex},
    time::Duration,
};

/// How long a process group may take to exit on its own before being killed.
const GRACE_PERIOD: Duration = Duration::from_millis(3_000);
const POLL_INTERVAL: Duration = Duration::from_millis(100);

pub type ProcessSlot = Arc<Mutex<Option<Child>>>;

/// Put the command in its own process group so the whole tree can be signalled.
pub fn isolate_process_group(command: &mut Command) {
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
        command.creation_flags(CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP);
    }
}

#[cfg(unix)]
fn signal_group(pid: u32, signal: i32) {
    // Negating the pid targets the whole group led by that process.
    unsafe {
        libc::kill(-(pid as i32), signal);
    }
}

#[cfg(windows)]
fn signal_group(pid: u32, force: bool) {
    let mut command = Command::new("taskkill.exe");
    command.arg("/PID").arg(pid.to_string()).arg("/T");
    if force {
        command.arg("/F");
    }
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    let _ = command.output();
}

fn request_exit(pid: u32) {
    #[cfg(unix)]
    signal_group(pid, libc::SIGTERM);
    #[cfg(windows)]
    signal_group(pid, false);
}

fn force_exit(pid: u32) {
    #[cfg(unix)]
    signal_group(pid, libc::SIGKILL);
    #[cfg(windows)]
    signal_group(pid, true);
}

/// Terminate a whole process tree and reap it. Returns `true` when a process
/// was actually running and has now exited.
pub fn stop_process_tree(slot: &ProcessSlot) -> bool {
    let Ok(mut guard) = slot.lock() else {
        return false;
    };
    let Some(child) = guard.as_mut() else {
        return false;
    };
    if matches!(child.try_wait(), Ok(Some(_))) {
        *guard = None;
        return false;
    }

    let pid = child.id();
    request_exit(pid);

    let deadline = std::time::Instant::now() + GRACE_PERIOD;
    let mut exited = false;
    while std::time::Instant::now() < deadline {
        match child.try_wait() {
            Ok(Some(_)) => {
                exited = true;
                break;
            }
            Ok(None) => std::thread::sleep(POLL_INTERVAL),
            Err(_) => break,
        }
    }

    if !exited {
        force_exit(pid);
        let _ = child.kill();
        let _ = child.wait();
    }
    *guard = None;
    true
}

fn pid_file(engine_data_dir: &Path, name: &str) -> PathBuf {
    engine_data_dir.join(format!("{name}.pid"))
}

/// Record the pid of a freshly spawned process so a later run can clean it up
/// if this one is force-quit or crashes before it can terminate the tree.
pub fn remember(engine_data_dir: &Path, name: &str, pid: u32) {
    let _ = fs::create_dir_all(engine_data_dir);
    let _ = fs::write(pid_file(engine_data_dir, name), pid.to_string());
}

pub fn forget(engine_data_dir: &Path, name: &str) {
    let _ = fs::remove_file(pid_file(engine_data_dir, name));
}

#[cfg(unix)]
fn process_exists(pid: u32) -> bool {
    // Signal 0 performs the permission and existence checks without delivering.
    unsafe { libc::kill(pid as i32, 0) == 0 }
}

#[cfg(windows)]
fn process_exists(pid: u32) -> bool {
    let Ok(output) = Command::new("tasklist.exe")
        .arg("/FI")
        .arg(format!("PID eq {pid}"))
        .arg("/NH")
        .output()
    else {
        return false;
    };
    String::from_utf8_lossy(&output.stdout).contains(&pid.to_string())
}

/// A leftover pid file means the previous run did not shut down cleanly.
/// Terminate whatever it left behind before starting a new runtime, so engine
/// processes cannot accumulate across crashes.
pub fn reap_orphan(engine_data_dir: &Path, name: &str) -> bool {
    let path = pid_file(engine_data_dir, name);
    let Ok(raw) = fs::read_to_string(&path) else {
        return false;
    };
    let _ = fs::remove_file(&path);
    let Ok(pid) = raw.trim().parse::<u32>() else {
        return false;
    };
    if pid <= 1 || !process_exists(pid) {
        return false;
    }
    request_exit(pid);
    let deadline = std::time::Instant::now() + GRACE_PERIOD;
    while std::time::Instant::now() < deadline {
        if !process_exists(pid) {
            return true;
        }
        std::thread::sleep(POLL_INTERVAL);
    }
    force_exit(pid);
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pid_files_round_trip_and_ignore_dead_processes() {
        let temporary = tempfile::tempdir().expect("temporary directory");
        let data_dir = temporary.path();

        assert!(
            !reap_orphan(data_dir, "runtime"),
            "no pid file, nothing to do"
        );

        // A pid that cannot belong to a live engine must be discarded, not signalled.
        remember(data_dir, "runtime", 0);
        assert!(!reap_orphan(data_dir, "runtime"));
        assert!(
            !pid_file(data_dir, "runtime").exists(),
            "a stale pid file is always removed"
        );

        remember(data_dir, "runtime", 4242);
        assert!(pid_file(data_dir, "runtime").exists());
        forget(data_dir, "runtime");
        assert!(!pid_file(data_dir, "runtime").exists());
    }

    #[test]
    fn stopping_an_empty_slot_is_a_no_op() {
        let slot: ProcessSlot = Arc::new(Mutex::new(None));
        assert!(!stop_process_tree(&slot));
    }

    #[cfg(unix)]
    #[test]
    fn stops_a_running_process_tree() {
        let mut command = Command::new("/bin/sh");
        command.arg("-c").arg("sleep 120");
        isolate_process_group(&mut command);
        let child = command.spawn().expect("child process");
        let pid = child.id();
        let slot: ProcessSlot = Arc::new(Mutex::new(Some(child)));

        assert!(stop_process_tree(&slot));
        assert!(
            slot.lock().expect("slot").is_none(),
            "the reaped child is cleared from the slot"
        );
        assert!(!process_exists(pid), "the process group is gone");
    }
}
