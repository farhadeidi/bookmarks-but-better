//! RFC 3339 validation for the owned timestamp fields.
//!
//! Timestamps are stored, compared and returned as the exact text the vault
//! found on disk. Nothing here parses them into a calendar type: the format core
//! only needs to know whether a value is well formed enough to be trusted, and
//! keeping the original text is what makes an unchanged field byte-identical.

/// Returns `true` when `text` is a well-formed RFC 3339 date and time.
///
/// Accepts the case-insensitive `t` separator and `z` zone designator that
/// RFC 3339 permits, an optional fractional second, and a numeric offset.
#[must_use]
pub fn is_rfc3339(text: &str) -> bool {
    let bytes = text.as_bytes();
    if bytes.len() < 20 || !text.is_ascii() {
        return false;
    }

    let digits = |range: core::ops::Range<usize>| -> Option<u32> {
        text.get(range)
            .filter(|slice| slice.bytes().all(|byte| byte.is_ascii_digit()))
            .and_then(|slice| slice.parse().ok())
    };

    let (Some(year), Some(month), Some(day)) = (digits(0..4), digits(5..7), digits(8..10)) else {
        return false;
    };
    if bytes[4] != b'-' || bytes[7] != b'-' || !matches!(bytes[10], b'T' | b't' | b' ') {
        return false;
    }
    if month == 0 || month > 12 || day == 0 || day > days_in_month(year, month) {
        return false;
    }

    let (Some(hour), Some(minute), Some(second)) = (digits(11..13), digits(14..16), digits(17..19))
    else {
        return false;
    };
    if bytes[13] != b':' || bytes[16] != b':' {
        return false;
    }
    // Second 60 is a leap second, which RFC 3339 explicitly allows.
    if hour > 23 || minute > 59 || second > 60 {
        return false;
    }

    let mut rest = &text[19..];
    if let Some(fraction) = rest.strip_prefix('.') {
        let digits = fraction.bytes().take_while(u8::is_ascii_digit).count();
        if digits == 0 {
            return false;
        }
        rest = &fraction[digits..];
    }

    is_offset(rest)
}

fn is_offset(text: &str) -> bool {
    if matches!(text, "Z" | "z") {
        return true;
    }
    let bytes = text.as_bytes();
    if bytes.len() != 6 || !matches!(bytes[0], b'+' | b'-') || bytes[3] != b':' {
        return false;
    }
    let Ok(hours) = text[1..3].parse::<u32>() else {
        return false;
    };
    let Ok(minutes) = text[4..6].parse::<u32>() else {
        return false;
    };
    text[1..3]
        .bytes()
        .chain(text[4..6].bytes())
        .all(|byte| byte.is_ascii_digit())
        && hours <= 23
        && minutes <= 59
}

const fn days_in_month(year: u32, month: u32) -> u32 {
    match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if is_leap_year(year) => 29,
        2 => 28,
        _ => 0,
    }
}

const fn is_leap_year(year: u32) -> bool {
    year.is_multiple_of(4) && (!year.is_multiple_of(100) || year.is_multiple_of(400))
}

#[cfg(test)]
mod tests {
    use super::is_rfc3339;

    #[test]
    fn accepts_well_formed_timestamps() {
        for value in [
            "2026-01-01T00:00:00Z",
            "2026-01-01t00:00:00z",
            "2026-01-01 00:00:00Z",
            "2026-07-27T13:45:09.123Z",
            "2026-07-27T13:45:09.123456789+02:00",
            "1996-12-19T16:39:57-08:00",
            "1990-12-31T23:59:60Z",
            "2024-02-29T12:00:00Z",
            "2000-02-29T12:00:00Z",
        ] {
            assert!(is_rfc3339(value), "expected {value:?} to be accepted");
        }
    }

    #[test]
    fn rejects_malformed_timestamps() {
        for value in [
            "",
            "2026-01-01",
            "2026-01-01T00:00:00",
            "2026-13-01T00:00:00Z",
            "2026-00-01T00:00:00Z",
            "2026-01-32T00:00:00Z",
            "2023-02-29T00:00:00Z",
            "1900-02-29T00:00:00Z",
            "2026-01-01T24:00:00Z",
            "2026-01-01T00:60:00Z",
            "2026-01-01T00:00:61Z",
            "2026-01-01T00:00:00.Z",
            "2026-01-01T00:00:00+2:00",
            "2026-01-01T00:00:00+02:60",
            "2026/01/01T00:00:00Z",
            "20260101T000000Z",
            "2026-01-01T00:00:00Zextra",
            "٢٠٢٦-٠١-٠١T٠٠:٠٠:٠٠Z",
        ] {
            assert!(!is_rfc3339(value), "expected {value:?} to be rejected");
        }
    }
}
