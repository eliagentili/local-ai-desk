//! System notifications for work that finishes while the user is elsewhere.
//!
//! Transcribing a long video or translating a large PDF takes minutes to hours,
//! and the whole point of a queue is that the user goes and does something else.
//! Notifications are therefore sent **only when the window is not focused**: with
//! the app in front, the activity list already says everything, and a banner over
//! it would be noise the user cannot turn off.

use tauri_plugin_notification::NotificationExt;

use crate::{
    app_log,
    database::{self, AppState, BatchOutcome},
    models::JobSpec,
};

/// Terminal outcome of a single job, as far as the user is concerned.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum JobOutcome {
    Completed,
    Failed,
    Cancelled,
}

/// Is the user looking at the app right now?
///
/// Treated as "yes" whenever it cannot be established, so an uncertain answer
/// errs towards silence rather than towards interrupting.
fn window_has_focus(state: &AppState) -> bool {
    let Some(app) = state.app.as_ref() else {
        return true;
    };
    use tauri::Manager;
    app.get_webview_window("main")
        .and_then(|window| window.is_focused().ok())
        .unwrap_or(true)
}

fn show(state: &AppState, title: &str, body: &str) {
    let Some(app) = state.app.as_ref() else {
        return;
    };
    if let Err(error) = app.notification().builder().title(title).body(body).show() {
        // A refused or unavailable notification centre is not a failure of the
        // job: it is recorded and forgotten.
        app_log::record(&format!("notifica non mostrata: {error}"));
    }
}

/// Announce what happened, once per job failure and once per finished batch.
///
/// A 500-file batch must not produce 500 banners, so only the first failure of a
/// batch is announced individually; the rest are summarised when the batch ends.
pub async fn after_job(state: &AppState, spec: &JobSpec, outcome: JobOutcome) {
    if window_has_focus(state) {
        return;
    }
    let database_path = state.database_path.clone();
    let batch_id = spec.batch_id.clone();
    let Ok(Ok(batch)) = tauri::async_runtime::spawn_blocking(move || {
        database::batch_outcome(&database_path, &batch_id)
    })
    .await
    else {
        return;
    };

    let announced_this_job = outcome == JobOutcome::Failed && batch.failed == 1;
    if announced_this_job {
        show(
            state,
            "Lavoro non riuscito",
            &format!(
                "{}: apri Attività per vedere il motivo e riprovare.",
                spec.item.name
            ),
        );
    }
    if batch.pending > 0 {
        return;
    }
    let total = batch.completed + batch.failed + batch.cancelled;
    // A batch of one whose single failure was just announced needs nothing more,
    // and a batch the user cancelled themselves is not news.
    if total <= 1 && announced_this_job {
        return;
    }
    if batch.completed == 0 && batch.failed == 0 {
        return;
    }
    let (title, body) = batch_summary(&batch);
    show(state, title, &body);
}

/// What to say about a batch that has just finished. Split out so the wording is
/// testable without a window, a queue or a notification centre.
fn batch_summary(batch: &BatchOutcome) -> (&'static str, String) {
    let mut parts = Vec::new();
    if batch.completed > 0 {
        parts.push(match batch.completed {
            1 => "1 risultato pronto".to_string(),
            count => format!("{count} risultati pronti"),
        });
    }
    if batch.failed > 0 {
        parts.push(match batch.failed {
            1 => "1 non riuscito".to_string(),
            count => format!("{count} non riusciti"),
        });
    }
    if batch.cancelled > 0 {
        parts.push(match batch.cancelled {
            1 => "1 annullato".to_string(),
            count => format!("{count} annullati"),
        });
    }
    let title = if batch.failed > 0 {
        "Elaborazione conclusa con errori"
    } else {
        "Elaborazione conclusa"
    };
    (title, parts.join(", "))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_summary_names_every_outcome_and_flags_the_failures_in_the_title() {
        let (title, body) = batch_summary(&BatchOutcome {
            pending: 0,
            completed: 3,
            failed: 1,
            cancelled: 0,
        });
        assert_eq!(title, "Elaborazione conclusa con errori");
        assert_eq!(body, "3 risultati pronti, 1 non riuscito");

        let (title, body) = batch_summary(&BatchOutcome {
            pending: 0,
            completed: 1,
            failed: 0,
            cancelled: 0,
        });
        assert_eq!(title, "Elaborazione conclusa");
        assert_eq!(body, "1 risultato pronto");
    }
}
