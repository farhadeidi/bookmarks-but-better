//! `bookmarks-but-better setup`: the guided first run.
//!
//! Setup is the one place `bookmarks-but-better` asks questions, and it is deliberately split in
//! two. [`plan`] does all the *asking* and produces a [`SetupPlan`]; nothing in
//! it writes, creates or starts anything. The returned [`SetupPlan`] and its
//! fields are then what the caller acts on. That split is what makes
//! "never initialize a directory without confirmation" a property a test can
//! assert rather than a claim about control flow.
//!
//! The prompt itself is a trait so that tests drive the whole conversation with
//! scripted answers and assert on the exact questions asked — including that a
//! question was asked at all.

use std::io::{self, BufRead as _, Write as _};
use std::net::{Ipv4Addr, SocketAddr, TcpListener};
use std::path::{Path, PathBuf};

use crate::doctor;
use crate::server::DEFAULT_PORT;

/// Somewhere to ask a question and print a line.
pub trait Prompt {
    /// Asks `question` and returns the answer, trimmed.
    ///
    /// # Errors
    ///
    /// Returns any I/O error from reading the answer. End of input is an
    /// error, not an empty answer: a setup being piped `/dev/null` must stop
    /// rather than take every default in silence.
    fn ask(&mut self, question: &str) -> io::Result<String>;

    /// Prints a line of explanation.
    fn tell(&mut self, message: &str);
}

/// The real terminal.
#[derive(Debug, Default)]
pub struct Terminal;

impl Prompt for Terminal {
    fn ask(&mut self, question: &str) -> io::Result<String> {
        print!("{question} ");
        io::stdout().flush()?;

        let mut answer = String::new();
        let read = io::stdin().lock().read_line(&mut answer)?;
        if read == 0 {
            return Err(io::Error::new(
                io::ErrorKind::UnexpectedEof,
                "setup needs answers, and standard input ended",
            ));
        }
        Ok(answer.trim().to_owned())
    }

    fn tell(&mut self, message: &str) {
        println!("{message}");
    }
}

/// What the user chose. Nothing here has happened yet.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SetupPlan {
    /// The vault directory.
    pub vault: PathBuf,
    /// Whether the vault still has to be initialized — always confirmed.
    pub initialize: bool,
    /// The port the service should serve on.
    pub port: u16,
}

/// Why setup stopped.
#[derive(Debug)]
#[non_exhaustive]
pub enum SetupError {
    /// Reading an answer failed, or input ended.
    Io(io::Error),
    /// The user declined something setup cannot proceed without.
    Declined(&'static str),
    /// The named vault cannot be used, with the reason to show.
    Unusable(String),
}

impl core::fmt::Display for SetupError {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        match self {
            Self::Io(error) => write!(f, "{error}"),
            Self::Declined(what) => write!(f, "setup stopped: {what}"),
            Self::Unusable(reason) => f.write_str(reason),
        }
    }
}

impl core::error::Error for SetupError {}

impl From<io::Error> for SetupError {
    fn from(error: io::Error) -> Self {
        Self::Io(error)
    }
}

/// Whether a `yes/no` answer is yes. An empty answer takes `default`.
fn is_yes(answer: &str, default: bool) -> bool {
    match answer.trim().to_ascii_lowercase().as_str() {
        "" => default,
        "y" | "yes" => true,
        _ => false,
    }
}

/// Runs the whole conversation and returns what the user chose.
///
/// Asks, in order: create a new vault or use an existing one; which directory;
/// then — for a new vault — an explicit confirmation before anything would be
/// written, and — for an existing one — a `doctor` check whose findings are
/// shown before continuing. Finally a port, defaulting to
/// [`DEFAULT_PORT`], checked for availability.
///
/// # Errors
///
/// [`SetupError::Declined`] when the user says no to something required,
/// [`SetupError::Unusable`] when the chosen directory cannot be a vault, and
/// [`SetupError::Io`] when input fails.
pub fn plan(prompt: &mut impl Prompt) -> Result<SetupPlan, SetupError> {
    prompt.tell("This sets up a local bookmarks-but-better daemon serving one vault on loopback.");
    prompt.tell("");

    let existing = loop {
        let answer = prompt.ask("Create a [n]ew vault, or use an [e]xisting one? [n/e]:")?;
        match answer.to_ascii_lowercase().as_str() {
            "n" | "new" => break false,
            "e" | "existing" => break true,
            _ => prompt.tell("Answer `n` for a new vault or `e` for an existing one."),
        }
    };

    let vault = ask_vault_path(prompt)?;

    let initialize = if existing {
        check_existing(prompt, &vault)?
    } else {
        confirm_new(prompt, &vault)?
    };

    let port = ask_port(prompt)?;

    Ok(SetupPlan {
        vault,
        initialize,
        port,
    })
}

fn ask_vault_path(prompt: &mut impl Prompt) -> Result<PathBuf, SetupError> {
    loop {
        let answer = prompt.ask("Vault directory (absolute path):")?;
        if answer.is_empty() {
            // There is no default and there never will be: the one directory
            // the daemon may touch is the one the user named.
            prompt.tell(
                "A path is required — bookmarks-but-better never guesses which directory is yours.",
            );
            continue;
        }
        let path = PathBuf::from(&answer);
        if !path.is_absolute() {
            prompt.tell(
                "Use an absolute path: a service is started with no working directory of yours.",
            );
            continue;
        }
        return Ok(path);
    }
}

/// The "create new" branch: nothing is written without an explicit yes.
fn confirm_new(prompt: &mut impl Prompt, vault: &Path) -> Result<bool, SetupError> {
    if vault
        .join(bookmarks_but_better_vault_core::FOLDER_FILE_NAME)
        .is_file()
    {
        prompt.tell(&format!(
            "{} is already a vault, so it will be used as it is.",
            vault.display()
        ));
        return Ok(false);
    }

    if vault.is_dir() {
        let empty = std::fs::read_dir(vault).is_ok_and(|mut entries| entries.next().is_none());
        if !empty {
            prompt.tell(&format!(
                "{} already exists and is not empty. Initializing adds bookmarks-but-better's metadata files; nothing else is touched.",
                vault.display()
            ));
        }
    }

    let answer = prompt.ask(&format!(
        "Initialize {} as a vault? [y/N]:",
        vault.display()
    ))?;
    if is_yes(&answer, false) {
        Ok(true)
    } else {
        Err(SetupError::Declined("the vault was not initialized"))
    }
}

/// The "use existing" branch: validated with `doctor` before it is accepted.
fn check_existing(prompt: &mut impl Prompt, vault: &Path) -> Result<bool, SetupError> {
    let report = doctor::examine(vault).map_err(|error| {
        SetupError::Unusable(format!("{} could not be read: {error}", vault.display()))
    })?;

    if !report.initialized {
        prompt.tell(&format!(
            "{} is not a vault yet: it has no {}.",
            vault.display(),
            bookmarks_but_better_vault_core::FOLDER_FILE_NAME
        ));
        let answer = prompt.ask("Initialize it now? [y/N]:")?;
        if !is_yes(&answer, false) {
            return Err(SetupError::Declined("the directory was left untouched"));
        }
        return Ok(true);
    }

    prompt.tell(&format!(
        "{}: {} bookmarks, {} folders, {} errors, {} warnings.",
        vault.display(),
        report.bookmarks,
        report.folders,
        report.errors.len(),
        report.warnings.len()
    ));

    if !report.is_healthy() {
        for finding in report.errors.iter().chain(report.warnings.iter()) {
            prompt.tell(&format!("  [{}] {}", finding.code, finding.path));
        }
        let answer = prompt.ask("This vault has problems. Continue anyway? [y/N]:")?;
        if !is_yes(&answer, false) {
            return Err(SetupError::Declined(
                "fix the vault (see `bookmarks-but-better doctor`) and run setup again",
            ));
        }
    }

    Ok(false)
}

fn ask_port(prompt: &mut impl Prompt) -> Result<u16, SetupError> {
    loop {
        let answer = prompt.ask(&format!("Port [{DEFAULT_PORT}]:"))?;
        let port = if answer.is_empty() {
            DEFAULT_PORT
        } else {
            match answer.parse::<u16>() {
                Ok(0) | Err(_) => {
                    prompt.tell("Enter a port between 1 and 65535.");
                    continue;
                }
                Ok(port) => port,
            }
        };

        if port_is_free(port) {
            return Ok(port);
        }

        prompt.tell(&format!(
            "Something is already listening on 127.0.0.1:{port}."
        ));
        let answer = prompt.ask("Choose a different port? [Y/n]:")?;
        if !is_yes(&answer, true) {
            return Ok(port);
        }
    }
}

/// Whether nothing is listening on loopback at `port`.
///
/// Binding and immediately dropping is the only answer that is not a guess.
/// It races anything that grabs the port in between, which is why the daemon
/// still reports a bind failure of its own rather than trusting this.
#[must_use]
pub fn port_is_free(port: u16) -> bool {
    TcpListener::bind(SocketAddr::from((Ipv4Addr::LOCALHOST, port))).is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::VecDeque;

    /// A scripted conversation: answers go in, questions come out.
    #[derive(Debug, Default)]
    struct Scripted {
        answers: VecDeque<String>,
        asked: Vec<String>,
        told: Vec<String>,
    }

    impl Scripted {
        fn with(answers: &[&str]) -> Self {
            Self {
                answers: answers.iter().map(|answer| (*answer).to_owned()).collect(),
                ..Self::default()
            }
        }

        fn asked_about(&self, needle: &str) -> bool {
            self.asked.iter().any(|question| question.contains(needle))
        }
    }

    impl Prompt for Scripted {
        fn ask(&mut self, question: &str) -> io::Result<String> {
            self.asked.push(question.to_owned());
            self.answers
                .pop_front()
                .ok_or_else(|| io::Error::new(io::ErrorKind::UnexpectedEof, "no scripted answer"))
        }

        fn tell(&mut self, message: &str) {
            self.told.push(message.to_owned());
        }
    }

    /// A free port to offer setup, found the same way setup checks one.
    fn free_port() -> u16 {
        TcpListener::bind(SocketAddr::from((Ipv4Addr::LOCALHOST, 0)))
            .expect("bind an ephemeral port")
            .local_addr()
            .expect("local address")
            .port()
    }

    #[test]
    fn creating_a_new_vault_requires_an_explicit_confirmation() {
        let directory = tempfile::tempdir().expect("temp dir");
        let vault = directory.path().join("Bookmarks");
        let port = free_port();

        let mut prompt = Scripted::with(&["n", &vault.to_string_lossy(), "y", &port.to_string()]);
        let plan = plan(&mut prompt).expect("a confirmed plan");

        assert_eq!(plan.vault, vault);
        assert!(plan.initialize);
        assert!(
            prompt.asked_about("Initialize"),
            "the confirmation must actually be asked: {:?}",
            prompt.asked
        );
    }

    #[test]
    fn declining_the_confirmation_initializes_nothing() {
        let directory = tempfile::tempdir().expect("temp dir");
        let vault = directory.path().join("Bookmarks");

        let mut prompt = Scripted::with(&["n", &vault.to_string_lossy(), "n"]);
        let error = plan(&mut prompt).expect_err("a declined setup stops");

        assert!(matches!(error, SetupError::Declined(_)), "{error}");
        assert!(
            !vault.exists(),
            "a refused setup must not create the directory"
        );
    }

    #[test]
    fn an_empty_answer_defaults_to_no_for_initialization() {
        // The dangerous option is never the default.
        let directory = tempfile::tempdir().expect("temp dir");
        let vault = directory.path().join("Bookmarks");

        let mut prompt = Scripted::with(&["n", &vault.to_string_lossy(), ""]);
        assert!(matches!(
            plan(&mut prompt).expect_err("declined"),
            SetupError::Declined(_)
        ));
        assert!(!vault.exists());
    }

    #[test]
    fn an_existing_healthy_vault_is_validated_and_not_reinitialized() {
        let directory = tempfile::tempdir().expect("temp dir");
        crate::initialize(directory.path()).expect("initialize");
        let port = free_port();

        let mut prompt =
            Scripted::with(&["e", &directory.path().to_string_lossy(), &port.to_string()]);
        let plan = plan(&mut prompt).expect("an existing vault plan");

        assert!(
            !plan.initialize,
            "an initialized vault is not re-initialized"
        );
        assert_eq!(plan.port, port);
        assert!(
            prompt.told.iter().any(|line| line.contains("bookmarks")),
            "the doctor summary is shown: {:?}",
            prompt.told
        );
    }

    #[test]
    fn an_existing_directory_that_is_not_a_vault_still_needs_confirmation() {
        let directory = tempfile::tempdir().expect("temp dir");
        let port = free_port();

        let mut prompt = Scripted::with(&[
            "e",
            &directory.path().to_string_lossy(),
            "y",
            &port.to_string(),
        ]);
        let accepted = plan(&mut prompt).expect("plan");

        assert!(accepted.initialize);
        assert!(prompt.asked_about("Initialize it now?"));
        // And declining leaves it alone.
        let mut declining = Scripted::with(&["e", &directory.path().to_string_lossy(), "n"]);
        assert!(matches!(
            plan(&mut declining).expect_err("declined"),
            SetupError::Declined(_)
        ));
        assert!(
            !directory
                .path()
                .join(".bookmarks-but-better-folder.md")
                .exists()
        );
    }

    #[test]
    fn an_unhealthy_vault_is_reported_and_needs_a_second_confirmation() {
        let directory = tempfile::tempdir().expect("temp dir");
        crate::initialize(directory.path()).expect("initialize");
        // A bookmark with no URL parses but cannot be written.
        std::fs::write(
            directory.path().join("Broken--aaaabbbb.md"),
            "---\nbookmarks_but_better_id: aaaabbbb\nbookmarks_but_better_url:\nbookmarks_but_better_title: Broken\n\
             bookmarks_but_better_created: 2026-01-01T00:00:00Z\nbookmarks_but_better_updated: 2026-01-01T00:00:00Z\n---\n",
        )
        .expect("write");

        let mut declining = Scripted::with(&["e", &directory.path().to_string_lossy(), "n"]);
        let error = plan(&mut declining).expect_err("a refused unhealthy vault stops setup");
        assert!(matches!(error, SetupError::Declined(_)), "{error}");
        assert!(declining.asked_about("Continue anyway?"));

        let port = free_port();
        let mut accepting = Scripted::with(&[
            "e",
            &directory.path().to_string_lossy(),
            "y",
            &port.to_string(),
        ]);
        assert!(plan(&mut accepting).is_ok(), "the user may override");
    }

    #[test]
    fn the_port_defaults_to_52222_when_it_is_free() {
        let directory = tempfile::tempdir().expect("temp dir");
        crate::initialize(directory.path()).expect("initialize");

        // Only meaningful when nothing else on the machine holds it.
        if !port_is_free(DEFAULT_PORT) {
            return;
        }

        let mut prompt = Scripted::with(&["e", &directory.path().to_string_lossy(), ""]);
        assert_eq!(plan(&mut prompt).expect("plan").port, DEFAULT_PORT);
    }

    #[test]
    fn a_port_already_in_use_is_reported_before_it_is_accepted() {
        let directory = tempfile::tempdir().expect("temp dir");
        crate::initialize(directory.path()).expect("initialize");

        // Held for the duration of the test, so the check really fails.
        let held = TcpListener::bind(SocketAddr::from((Ipv4Addr::LOCALHOST, 0))).expect("bind");
        let taken = held.local_addr().expect("addr").port();
        let free = free_port();

        let mut prompt = Scripted::with(&[
            "e",
            &directory.path().to_string_lossy(),
            &taken.to_string(),
            "y",
            &free.to_string(),
        ]);
        let plan = plan(&mut prompt).expect("plan");

        assert_eq!(plan.port, free, "setup moved off the busy port");
        assert!(
            prompt
                .told
                .iter()
                .any(|line| line.contains("already listening")),
            "{:?}",
            prompt.told
        );
    }

    #[test]
    fn a_busy_port_can_still_be_kept_deliberately() {
        let directory = tempfile::tempdir().expect("temp dir");
        crate::initialize(directory.path()).expect("initialize");
        let held = TcpListener::bind(SocketAddr::from((Ipv4Addr::LOCALHOST, 0))).expect("bind");
        let taken = held.local_addr().expect("addr").port();

        let mut prompt = Scripted::with(&[
            "e",
            &directory.path().to_string_lossy(),
            &taken.to_string(),
            "n",
        ]);
        assert_eq!(plan(&mut prompt).expect("plan").port, taken);
    }

    #[test]
    fn a_relative_path_is_refused_and_asked_again() {
        let directory = tempfile::tempdir().expect("temp dir");
        crate::initialize(directory.path()).expect("initialize");
        let port = free_port();

        let mut prompt = Scripted::with(&[
            "e",
            "relative/path",
            &directory.path().to_string_lossy(),
            &port.to_string(),
        ]);
        assert_eq!(plan(&mut prompt).expect("plan").vault, directory.path());
        assert!(
            prompt.told.iter().any(|line| line.contains("absolute")),
            "{:?}",
            prompt.told
        );
    }

    #[test]
    fn an_unrecognised_choice_is_asked_again_rather_than_assumed() {
        let directory = tempfile::tempdir().expect("temp dir");
        crate::initialize(directory.path()).expect("initialize");
        let port = free_port();

        let mut prompt = Scripted::with(&[
            "maybe",
            "e",
            &directory.path().to_string_lossy(),
            &port.to_string(),
        ]);
        assert!(plan(&mut prompt).is_ok());
        assert_eq!(
            prompt
                .asked
                .iter()
                .filter(|question| question.contains("[n/e]"))
                .count(),
            2,
            "the choice is repeated, never defaulted"
        );
    }

    #[test]
    fn input_ending_stops_setup_rather_than_taking_defaults() {
        let mut prompt = Scripted::with(&[]);
        assert!(matches!(
            plan(&mut prompt).expect_err("no answers"),
            SetupError::Io(_)
        ));
    }
}
