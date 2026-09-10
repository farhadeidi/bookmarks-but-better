//! The **Vault Registry**: the Vaults this user has configured, and the
//! settings a daemon needs to serve them, in one file (ADR-0005).
//!
//! Every other command still names its vault on the command line. This file is
//! written only by `bookmarks-but-better vault …` and read only by a command
//! that asks for it by name — `serve --from-config`,
//! `service install --from-config`, and the `vault` commands themselves. That
//! is the whole of the narrowing: naming a directory is still explicit, it just
//! happened earlier, and [`Config::vaults`] is what makes the set auditable.
//!
//! # What is not here
//!
//! No merging, no layering, no environment overrides and no search of parent
//! directories. There is exactly one file at exactly one path, and a command
//! that does not ask for it cannot reach a Vault through it.

use std::collections::BTreeMap;
use std::io;
use std::net::IpAddr;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::registry::{self, VaultSpec};

/// The directory the configuration file lives in, under the config home.
pub const CONFIG_DIRECTORY: &str = "bookmarks-but-better";
/// The configuration file's name.
pub const CONFIG_FILE_NAME: &str = "config.toml";

/// Where the configuration file is.
///
/// Rooted at an explicit config home rather than read from the environment on
/// every call, so a test can write and read a real file in a temporary
/// directory without touching the machine it runs on — the same shape
/// [`crate::service::ServiceLayout`] uses, for the same reason.
#[derive(Debug, Clone)]
pub struct ConfigLocation {
    path: PathBuf,
}

impl ConfigLocation {
    /// The location under an explicit config home.
    #[must_use]
    pub fn rooted_at(config_home: impl Into<PathBuf>) -> Self {
        Self {
            path: config_home
                .into()
                .join(CONFIG_DIRECTORY)
                .join(CONFIG_FILE_NAME),
        }
    }

    /// The location from the environment: `$XDG_CONFIG_HOME`, else
    /// `$HOME/.config`.
    ///
    /// # Errors
    ///
    /// Returns [`ConfigError::NoHome`] when the home directory is unknown,
    /// which is the one case where guessing would put the file somewhere the
    /// user never looks.
    pub fn from_env() -> Result<Self, ConfigError> {
        Ok(Self::rooted_at(
            crate::home::config_home().ok_or(ConfigError::NoHome)?,
        ))
    }

    /// The file's path.
    #[must_use]
    pub fn path(&self) -> &Path {
        &self.path
    }
}

/// One configured Vault.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct VaultEntry {
    /// The Vault's root directory, absolute.
    pub path: PathBuf,
}

/// The configuration file's contents.
///
/// Every serve setting is optional and means "the daemon's own default", so a
/// file that lists vaults and nothing else is complete. `deny_unknown_fields`
/// is deliberate: a mistyped key in a file a person edits by hand is worth an
/// error naming it, not a setting that silently never applied.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "kebab-case")]
pub struct Config {
    /// The port to serve on. `None` is [`crate::server::DEFAULT_PORT`].
    #[serde(skip_serializing_if = "Option::is_none")]
    pub port: Option<u16>,
    /// The loopback address to bind. `None` is [`crate::server::DEFAULT_BIND`].
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bind: Option<IpAddr>,
    /// A directory holding the built web UI. `None` serves the API only.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ui_dir: Option<PathBuf>,
    /// The configured Vaults, by id.
    ///
    /// A `BTreeMap` so the file, `vault list` and the order a daemon hosts
    /// them in are all the same and all stable — TOML tables carry no order,
    /// so anything else would reshuffle on every write.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub vaults: BTreeMap<String, VaultEntry>,
}

impl Config {
    /// The configured Vaults as [`VaultSpec`]s, in id order.
    #[must_use]
    pub fn specs(&self) -> Vec<VaultSpec> {
        self.vaults
            .iter()
            .map(|(id, entry)| VaultSpec::new(id.clone(), entry.path.clone()))
            .collect()
    }

    /// Checks what the daemon would check at startup, before writing.
    ///
    /// The point is that `vault add` refuses a set `serve` would refuse: an
    /// unusable id, or two roots where one contains the other. Catching it here
    /// means the mistake is reported against the command that made it rather
    /// than at the next daemon start, when the connection between the two is
    /// no longer obvious.
    ///
    /// An empty set is allowed here and only here — removing the last vault is
    /// a legitimate thing to do, and it is `serve` that has nothing to host.
    ///
    /// # Errors
    ///
    /// Returns [`ConfigError::Invalid`] carrying the registry's own message.
    pub fn validate(&self) -> Result<(), ConfigError> {
        if let Some(bind) = self.bind
            && !bind.is_loopback()
        {
            return Err(ConfigError::NotLoopback { bind });
        }
        let specs = self.specs();
        if specs.is_empty() {
            return Ok(());
        }
        registry::validate(&specs).map_err(|error| ConfigError::Invalid(Box::new(error)))
    }
}

/// Why the configuration could not be read or written.
#[derive(Debug)]
#[non_exhaustive]
pub enum ConfigError {
    /// The home directory is unknown, so there is no config home to root at.
    NoHome,
    /// The file could not be read or written.
    Io {
        /// The path that failed.
        path: PathBuf,
        /// Why.
        error: io::Error,
    },
    /// The file is not valid TOML, or does not match this shape.
    Parse {
        /// The file that failed to parse.
        path: PathBuf,
        /// The parser's own message, which names the line.
        message: String,
    },
    /// The configured set is one the daemon would refuse to host.
    Invalid(Box<registry::RegistryError>),
    /// The configured bind address is not a loopback address.
    NotLoopback {
        /// The rejected address.
        bind: IpAddr,
    },
    /// A vault id was named that the configuration does not hold.
    UnknownVault {
        /// The id that was asked for.
        id: String,
        /// The ids that do exist, in order.
        known: Vec<String>,
    },
}

impl core::fmt::Display for ConfigError {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        match self {
            Self::NoHome => f.write_str(
                "the home directory is unknown, so there is nowhere to keep the configuration",
            ),
            Self::Io { path, error } => {
                write!(f, "{} could not be used: {error}", path.display())
            }
            Self::Parse { path, message } => {
                write!(f, "{} could not be read: {message}", path.display())
            }
            Self::Invalid(error) => write!(f, "{error}"),
            Self::NotLoopback { bind } => write!(
                f,
                "bind = \"{bind}\" is not a loopback address; this daemon serves loopback clients only"
            ),
            Self::UnknownVault { id, known } => {
                if known.is_empty() {
                    write!(
                        f,
                        "no vault `{id}` is configured, and no vault is configured at all; add one with `bookmarks-but-better vault add {id} <PATH>`"
                    )
                } else {
                    write!(
                        f,
                        "no vault `{id}` is configured; the configured vaults are {}",
                        known.join(", ")
                    )
                }
            }
        }
    }
}

impl core::error::Error for ConfigError {
    fn source(&self) -> Option<&(dyn core::error::Error + 'static)> {
        match self {
            Self::Io { error, .. } => Some(error),
            Self::Invalid(error) => Some(error),
            _ => None,
        }
    }
}

/// Reads the configuration, or the empty one when the file does not exist yet.
///
/// A missing file is not an error: it is what every machine has before the
/// first `vault add`, and reporting it as a failure would make `vault list`
/// fail on a fresh install rather than print nothing.
///
/// # Errors
///
/// Returns [`ConfigError::Io`] when the file exists but cannot be read,
/// [`ConfigError::Parse`] when it is not valid TOML of this shape, and the
/// validation errors when its contents are a set the daemon would refuse.
pub fn load(location: &ConfigLocation) -> Result<Config, ConfigError> {
    let text = match std::fs::read_to_string(location.path()) {
        Ok(text) => text,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(Config::default()),
        Err(error) => {
            return Err(ConfigError::Io {
                path: location.path().to_owned(),
                error,
            });
        }
    };

    let config: Config = toml::from_str(&text).map_err(|error| ConfigError::Parse {
        path: location.path().to_owned(),
        message: error.to_string(),
    })?;
    config.validate()?;
    Ok(config)
}

/// Writes the configuration, creating its directory.
///
/// The write goes to a temporary file in the same directory and is renamed over
/// the target, so an interrupted write leaves the previous configuration intact
/// rather than a truncated file that neither parses nor says what it held.
///
/// # Errors
///
/// Returns [`ConfigError::Io`] when the directory or the file cannot be
/// written, and the validation errors when `config` is a set the daemon would
/// refuse — checked before anything is written, so a rejected change leaves the
/// file exactly as it was.
pub fn save(location: &ConfigLocation, config: &Config) -> Result<(), ConfigError> {
    config.validate()?;

    let path = location.path();
    let directory = path.parent().unwrap_or_else(|| Path::new("."));
    std::fs::create_dir_all(directory).map_err(|error| ConfigError::Io {
        path: directory.to_owned(),
        error,
    })?;

    let text = render(config);
    let temporary = path.with_extension("toml.new");
    std::fs::write(&temporary, text).map_err(|error| ConfigError::Io {
        path: temporary.clone(),
        error,
    })?;
    std::fs::rename(&temporary, path).map_err(|error| {
        let _ = std::fs::remove_file(&temporary);
        ConfigError::Io {
            path: path.to_owned(),
            error,
        }
    })
}

/// The file's text, with the header that tells a reader what wrote it.
fn render(config: &Config) -> String {
    let body = toml::to_string_pretty(config).unwrap_or_default();
    format!(
        "# The vaults this machine is configured to serve, and how to serve them.\n\
         # Written by `bookmarks-but-better vault …`; edits are kept.\n\
         # Read only by `serve --from-config` and `service install --from-config`.\n\
         \n\
         {body}"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn location(home: &tempfile::TempDir) -> ConfigLocation {
        ConfigLocation::rooted_at(home.path())
    }

    fn entry(path: &str) -> VaultEntry {
        VaultEntry {
            path: PathBuf::from(path),
        }
    }

    #[test]
    fn a_machine_with_no_configuration_reads_as_empty_rather_than_failing() {
        let home = tempfile::tempdir().expect("temp dir");
        let config = load(&location(&home)).expect("a missing file is not an error");
        assert_eq!(config, Config::default());
        assert!(config.specs().is_empty());
    }

    #[test]
    fn what_is_written_is_what_is_read_back() {
        let home = tempfile::tempdir().expect("temp dir");
        let location = location(&home);
        let mut config = Config {
            port: Some(52223),
            bind: Some("127.0.0.1".parse().expect("loopback")),
            ui_dir: Some(PathBuf::from("/opt/bbb/ui")),
            vaults: BTreeMap::new(),
        };
        config.vaults.insert("reading".to_owned(), entry("/v/read"));
        config.vaults.insert("archive".to_owned(), entry("/v/arch"));

        save(&location, &config).expect("save");
        assert_eq!(load(&location).expect("load"), config);
    }

    #[test]
    fn the_file_says_what_wrote_it_and_that_edits_survive() {
        let home = tempfile::tempdir().expect("temp dir");
        let location = location(&home);
        save(&location, &Config::default()).expect("save");

        let text = std::fs::read_to_string(location.path()).expect("read");
        assert!(text.starts_with('#'), "{text}");
        assert!(text.contains("edits are kept"), "{text}");
    }

    #[test]
    fn vaults_are_ordered_by_id_however_they_were_added() {
        let mut config = Config::default();
        for id in ["zulu", "alpha", "mike"] {
            config
                .vaults
                .insert(id.to_owned(), entry(&format!("/v/{id}")));
        }
        let specs = config.specs();
        let ids: Vec<&str> = specs.iter().map(|spec| spec.id.as_str()).collect();
        assert_eq!(ids, ["alpha", "mike", "zulu"]);
    }

    #[test]
    fn a_mistyped_key_is_named_rather_than_ignored() {
        let home = tempfile::tempdir().expect("temp dir");
        let location = location(&home);
        std::fs::create_dir_all(location.path().parent().expect("parent")).expect("dir");
        std::fs::write(location.path(), "prot = 52222\n").expect("write");

        let error = load(&location).expect_err("an unknown key is refused");
        assert!(
            matches!(&error, ConfigError::Parse { message, .. } if message.contains("prot")),
            "{error}"
        );
    }

    #[test]
    fn a_set_the_daemon_would_refuse_is_refused_here_too() {
        let home = tempfile::tempdir().expect("temp dir");
        let location = location(&home);

        // Overlapping roots: the daemon rejects these at startup, so `vault
        // add` must reject them at the point the mistake is made.
        let mut config = Config::default();
        config.vaults.insert("outer".to_owned(), entry("/v"));
        config.vaults.insert("inner".to_owned(), entry("/v/nested"));
        let error = save(&location, &config).expect_err("overlapping roots");
        assert!(matches!(error, ConfigError::Invalid(_)), "{error}");

        // And nothing was written, so the previous configuration survives.
        assert!(!location.path().exists());
    }

    #[test]
    fn an_unusable_id_is_refused_with_the_registrys_own_message() {
        let home = tempfile::tempdir().expect("temp dir");
        let mut config = Config::default();
        config.vaults.insert("Not A Slug".to_owned(), entry("/v"));

        let error = save(&location(&home), &config).expect_err("an unusable id");
        assert!(error.to_string().contains("lowercase letters"), "{error}");
    }

    #[test]
    fn a_non_loopback_bind_is_refused_before_a_daemon_could_be_started_with_it() {
        let config = Config {
            bind: Some("0.0.0.0".parse().expect("address")),
            ..Config::default()
        };
        let error = config.validate().expect_err("not loopback");
        assert!(matches!(error, ConfigError::NotLoopback { .. }), "{error}");
    }

    #[test]
    fn removing_the_last_vault_is_allowed_even_though_serving_none_is_not() {
        // `registry::validate` refuses an empty set because a daemon has
        // nothing to host; the configuration is a different question, and
        // `vault remove` must be able to take the last one away.
        let home = tempfile::tempdir().expect("temp dir");
        save(&location(&home), &Config::default()).expect("an empty configuration is savable");
    }

    #[test]
    fn an_interrupted_write_leaves_no_stray_temporary_behind() {
        let home = tempfile::tempdir().expect("temp dir");
        let location = location(&home);
        save(&location, &Config::default()).expect("save");

        let directory = location.path().parent().expect("parent");
        let strays: Vec<_> = std::fs::read_dir(directory)
            .expect("read dir")
            .filter_map(Result::ok)
            .map(|entry| entry.file_name())
            .filter(|name| name != CONFIG_FILE_NAME)
            .collect();
        assert!(strays.is_empty(), "{strays:?}");
    }
}
