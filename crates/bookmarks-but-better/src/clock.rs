//! RFC 3339 timestamps, in both directions.
//!
//! The vault stores timestamps as the exact RFC 3339 text it found on disk, and
//! `bookmarks-but-better-vault-core` deliberately validates that text without parsing it into a
//! calendar type — keeping the original bytes is what makes an untouched field
//! byte-identical after an update.
//!
//! The daemon needs two things the format core does not provide: a timestamp
//! for entries it creates, and an epoch-milliseconds rendering for the API's
//! `dateAdded`, which the web UI's `BookmarkNode` declares as a number.

use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;

/// The current UTC time as RFC 3339 text, for a newly created entry.
///
/// Truncated to whole seconds: sub-second precision on a bookmark's creation
/// time is noise in a file a human reads and diffs.
pub(crate) fn now_rfc3339() -> String {
    let now = OffsetDateTime::now_utc()
        .replace_nanosecond(0)
        .unwrap_or_else(|_| OffsetDateTime::now_utc());
    now.format(&Rfc3339)
        // The formatter only fails on a component the well-known description
        // cannot render, which cannot happen for a UTC `OffsetDateTime`.
        .unwrap_or_else(|_| String::from("1970-01-01T00:00:00Z"))
}

/// Parses RFC 3339 text into milliseconds since the Unix epoch.
///
/// Returns `None` for anything that does not parse, so an odd timestamp in a
/// user's file degrades to a missing `dateAdded` rather than to an error.
pub(crate) fn epoch_millis(text: &str) -> Option<i64> {
    let parsed = OffsetDateTime::parse(text, &Rfc3339).ok()?;
    i64::try_from(parsed.unix_timestamp_nanos() / 1_000_000).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn now_is_valid_rfc3339_by_the_core_definition() {
        let now = now_rfc3339();
        assert!(
            bookmarks_but_better_vault_core::is_rfc3339(&now),
            "{now} must satisfy the vault format"
        );
        assert!(now.ends_with('Z'), "{now} must be UTC");
    }

    #[test]
    fn epoch_millis_matches_a_known_instant() {
        assert_eq!(epoch_millis("1970-01-01T00:00:00Z"), Some(0));
        assert_eq!(
            epoch_millis("2026-01-01T00:00:00Z"),
            Some(1_767_225_600_000)
        );
        assert_eq!(
            epoch_millis("2026-01-01T00:00:00.500Z"),
            Some(1_767_225_600_500)
        );
    }

    #[test]
    fn unparseable_text_has_no_epoch() {
        assert_eq!(epoch_millis("yesterday"), None);
        assert_eq!(epoch_millis(""), None);
    }

    #[test]
    fn a_generated_timestamp_round_trips() {
        assert!(epoch_millis(&now_rfc3339()).is_some());
    }
}
