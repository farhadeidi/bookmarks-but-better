//! Watching the vault, without believing what the watcher says.
//!
//! Filesystem events are hints. They arrive late, they arrive coalesced, they
//! arrive for the daemon's own writes, and on every platform there is a queue
//! that can overflow and drop them entirely. Treating an event as an instruction
//! — "the file at this path changed, reload it" — builds a cache that is wrong
//! in exactly the cases that matter.
//!
//! So this module does only one thing with an event: it schedules a rescan.
//! Three mechanisms keep that honest:
//!
//! * **Debounce.** An editor saving a file produces a burst of events. The
//!   rescan waits for a quiet period so the burst costs one scan, not twenty.
//! * **Content-addressed publishing.** [`Vault::reconcile`] fingerprints what it
//!   finds and publishes nothing when the fingerprint is unchanged. This is what
//!   makes the daemon's own writes silent: by the time the watcher reacts, the
//!   tree it scans is the tree that was already published. No timestamp
//!   bookkeeping, no suppression window to get wrong.
//! * **Periodic reconciliation.** A scan runs on a timer regardless. If every
//!   event for a change is dropped, the vault is still correct within one
//!   interval.
//!
//! Symbolic links are not followed, matching the scanner: a link into a
//! directory outside the vault must not cause the daemon to watch that
//! directory.

use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use notify::{Config, RecommendedWatcher, RecursiveMode, Watcher as _};
use tokio::sync::{mpsc, watch};

use crate::vault::Vault;

/// How long the vault must be quiet before a burst of events is acted on.
pub(crate) const DEBOUNCE: Duration = Duration::from_millis(250);
/// How often the vault is reconciled even with no events at all.
pub(crate) const FALLBACK_INTERVAL: Duration = Duration::from_secs(30);

/// Tuning for [`spawn`].
#[derive(Debug, Clone, Copy)]
pub struct WatchOptions {
    /// The quiet period before a burst of events triggers a rescan.
    pub debounce: Duration,
    /// How often to rescan regardless of events.
    pub fallback_interval: Duration,
}

impl Default for WatchOptions {
    fn default() -> Self {
        Self {
            debounce: DEBOUNCE,
            fallback_interval: FALLBACK_INTERVAL,
        }
    }
}

/// A running watcher; shut it down with [`WatchHandle::shutdown`].
#[derive(Debug)]
pub struct WatchHandle {
    /// Dropping the watcher stops the platform backend, so it is kept alive
    /// here for exactly as long as the task that consumes its events.
    watcher: Option<RecommendedWatcher>,
    stop: watch::Sender<bool>,
    task: tokio::task::JoinHandle<()>,
}

impl WatchHandle {
    /// Stops watching and waits for the reconcile loop to finish.
    ///
    /// A rescan already in flight is allowed to complete, so shutdown never
    /// leaves a half-published tree.
    pub async fn shutdown(self) {
        let _ = self.stop.send(true);
        drop(self.watcher);
        let _ = self.task.await;
    }
}

/// Starts watching `vault` and reconciling it.
///
/// A watcher that cannot be created is not fatal: the periodic reconcile still
/// runs, so external edits are picked up within one interval instead of within
/// one debounce. The failure is logged and the daemon keeps serving.
#[must_use]
pub fn spawn(vault: Arc<Vault>, options: WatchOptions) -> WatchHandle {
    let (events_tx, events_rx) = mpsc::unbounded_channel();
    let (stop, stop_rx) = watch::channel(false);

    let watcher = match build_watcher(vault.root(), events_tx) {
        Ok(watcher) => Some(watcher),
        Err(error) => {
            tracing::warn!(
                error = %error,
                fallback_seconds = options.fallback_interval.as_secs(),
                "the filesystem watcher could not start; falling back to periodic rescans only"
            );
            None
        }
    };

    let task = tokio::spawn(reconcile_loop(vault, events_rx, stop_rx, options));
    WatchHandle {
        watcher,
        stop,
        task,
    }
}

fn build_watcher(
    root: &Path,
    events: mpsc::UnboundedSender<()>,
) -> notify::Result<RecommendedWatcher> {
    let mut watcher = RecommendedWatcher::new(
        move |result: notify::Result<notify::Event>| {
            // The event's contents are deliberately ignored: what changed is
            // decided by the rescan, not by the notification. Errors are hints
            // too — an overflow is precisely when a rescan is most needed.
            if let Err(error) = &result {
                tracing::debug!(error = %error, "filesystem watcher reported an error");
            }
            let _ = events.send(());
        },
        Config::default().with_follow_symlinks(false),
    )?;
    watcher.watch(root, RecursiveMode::Recursive)?;
    Ok(watcher)
}

async fn reconcile_loop(
    vault: Arc<Vault>,
    mut events: mpsc::UnboundedReceiver<()>,
    mut stop: watch::Receiver<bool>,
    options: WatchOptions,
) {
    let mut ticker = tokio::time::interval(options.fallback_interval);
    // The first tick fires immediately; the vault was just scanned at startup.
    ticker.tick().await;

    // Cleared when the watcher's channel closes, which is what happens when the
    // platform backend failed to start or has died. The loop must keep running
    // in that case — the periodic reconcile *is* the fallback, and breaking here
    // would quietly turn "degraded" into "not watching at all".
    let mut watching = true;

    loop {
        tokio::select! {
            biased;
            _ = stop.changed() => break,
            _ = ticker.tick() => reconcile(&vault, "periodic").await,
            received = events.recv(), if watching => {
                if received.is_some() {
                    drain(&mut events, options.debounce).await;
                    reconcile(&vault, "watcher").await;
                } else {
                    tracing::warn!("the filesystem watcher stopped; only periodic rescans remain");
                    watching = false;
                }
            }
        }
    }
}

/// Swallows further events until the vault has been quiet for `debounce`.
async fn drain(events: &mut mpsc::UnboundedReceiver<()>, debounce: Duration) {
    while tokio::time::timeout(debounce, events.recv())
        .await
        .is_ok_and(|received| received.is_some())
    {}
}

async fn reconcile(vault: &Arc<Vault>, trigger: &'static str) {
    let vault = Arc::clone(vault);
    let outcome = tokio::task::spawn_blocking(move || vault.reconcile()).await;
    match outcome {
        Ok(Ok((snapshot, true))) => tracing::info!(
            trigger,
            generation = snapshot.generation,
            "the vault changed on disk"
        ),
        Ok(Ok((_, false))) => tracing::trace!(trigger, "reconcile found no change"),
        Ok(Err(problem)) => {
            tracing::warn!(trigger, code = %problem.code(), "the vault could not be rescanned");
        }
        Err(error) => tracing::warn!(trigger, error = %error, "the rescan task failed"),
    }
}
