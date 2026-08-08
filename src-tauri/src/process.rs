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
///
/// Windows has no equivalent of SIGTERM for a windowless console process: an
/// unforced `taskkill` cannot reach one, so waiting for it to comply is pure
/// delay on every quit. There the tree is ended at once and the wait is only
/// long enough to reap it.
#[cfg(unix)]
const GRACE_PERIOD: Duration = Duration::from_millis(3_000);
#[cfg(windows)]
const GRACE_PERIOD: Duration = Duration::from_millis(400);
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
    // Unforced taskkill only posts WM_CLOSE, which a windowless child never
    // receives, so on Windows the polite request is already the forceful one.
    #[cfg(windows)]
    signal_group(pid, true);
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

/// Identity of the process that a pid file refers to.
///
/// The pid alone is not enough: operating systems recycle pids, and signalling
/// a recycled one would kill an unrelated program the user is running. The
/// executable name recorded at spawn time is compared before anything is sent.
fn process_identity(pid: u32) -> Option<String> {
    use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System};
    let mut system = System::new();
    system.refresh_processes_specifics(
        ProcessesToUpdate::Some(&[Pid::from_u32(pid)]),
        true,
        ProcessRefreshKind::nothing(),
    );
    system
        .process(Pid::from_u32(pid))
        .map(|process| process.name().to_string_lossy().to_ascii_lowercase())
}

/// Record a freshly spawned process so a later run can clean it up if this one
/// is force-quit or crashes before it can terminate the tree.
pub fn remember(engine_data_dir: &Path, name: &str, pid: u32) {
    let _ = fs::create_dir_all(engine_data_dir);
    let identity = process_identity(pid).unwrap_or_default();
    let _ = fs::write(
        pid_file(engine_data_dir, name),
        format!("{pid}\n{identity}"),
    );
}

/// Remove our own registration only. A second instance that started in the
/// meantime owns the file now, and erasing its entry would leave its engines
/// unrecoverable after a crash.
pub fn forget(engine_data_dir: &Path, name: &str) {
    let path = pid_file(engine_data_dir, name);
    let Ok(raw) = fs::read_to_string(&path) else {
        return;
    };
    let recorded: Option<u32> = raw.lines().next().and_then(|line| line.trim().parse().ok());
    if recorded.is_some_and(|pid| process_identity(pid).is_none()) {
        let _ = fs::remove_file(&path);
    }
}

/// Drop a registration unconditionally, once its process is known to be gone.
pub fn forget_now(engine_data_dir: &Path, name: &str) {
    let _ = fs::remove_file(pid_file(engine_data_dir, name));
}

/// A leftover pid file means the previous run did not shut down cleanly.
/// Terminate whatever it left behind before starting a new runtime, so engine
/// processes cannot accumulate across crashes.
///
/// Returns `true` only when a process we recognise was actually terminated.
pub fn reap_orphan(engine_data_dir: &Path, name: &str) -> bool {
    let path = pid_file(engine_data_dir, name);
    let Ok(raw) = fs::read_to_string(&path) else {
        return false;
    };
    let mut lines = raw.lines();
    let recorded_pid = lines.next().unwrap_or_default().trim().to_string();
    let recorded_identity = lines.next().unwrap_or_default().trim().to_ascii_lowercase();
    let _ = fs::remove_file(&path);

    let Ok(pid) = recorded_pid.parse::<u32>() else {
        return false;
    };
    if pid <= 1 {
        return false;
    }
    let Some(identity) = process_identity(pid) else {
        // Already gone: nothing to terminate, and nothing to signal blindly.
        return false;
    };
    // The pid may have been recycled onto an unrelated program since it was
    // written. Only a matching executable name proves this is still ours.
    if recorded_identity.is_empty() || identity != recorded_identity {
        return false;
    }

    request_exit(pid);
    let deadline = std::time::Instant::now() + GRACE_PERIOD;
    while std::time::Instant::now() < deadline {
        if process_identity(pid).is_none() {
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
    fn a_recycled_pid_is_never_signalled() {
        let temporary = tempfile::tempdir().expect("temporary directory");
        let data_dir = temporary.path();

        assert!(
            !reap_orphan(data_dir, "runtime"),
            "no pid file means nothing to do"
        );

        // Our own pid is alive, but it was recorded under a different name:
        // that is exactly what a recycled pid looks like, and it must be spared.
        let own_pid = std::process::id();
        let _ = fs::create_dir_all(data_dir);
        fs::write(
            pid_file(data_dir, "runtime"),
            format!("{own_pid}\nun-programma-che-non-abbiamo-avviato"),
        )
        .expect("pid file");
        assert!(!reap_orphan(data_dir, "runtime"));
        assert!(
            !pid_file(data_dir, "runtime").exists(),
            "the stale registration is cleared either way"
        );

        // A pid file with no identity at all is equally untrustworthy.
        fs::write(pid_file(data_dir, "runtime"), format!("{own_pid}")).expect("pid file");
        assert!(!reap_orphan(data_dir, "runtime"));

        // A pid that no longer exists is simply forgotten.
        remember(data_dir, "ollama", 0);
        assert!(!reap_orphan(data_dir, "ollama"));
    }

    #[test]
    fn a_registration_is_only_dropped_once_its_process_is_gone() {
        let temporary = tempfile::tempdir().expect("temporary directory");
        let data_dir = temporary.path();

        // A live process keeps its registration: erasing it would make the
        // engines of a still-running instance unrecoverable after a crash.
        remember(data_dir, "runtime", std::process::id());
        forget(data_dir, "runtime");
        assert!(pid_file(data_dir, "runtime").exists());

        forget_now(data_dir, "runtime");
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
        assert!(process_identity(pid).is_none(), "the process group is gone");
    }
}
