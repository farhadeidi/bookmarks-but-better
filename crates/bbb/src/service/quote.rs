//! Quoting a path or an argument for each service-definition format.
//!
//! Every one of these formats embeds a command line as *text*, and every one
//! escapes differently. A vault path is chosen by the user, so it routinely
//! contains spaces and non-ASCII characters and may legitimately contain
//! quotes, backslashes or `%`. Getting this wrong does not produce a syntax
//! error the user sees — it produces a service that silently serves the wrong
//! directory, or fails to start with a message about a path that does not
//! resemble what they typed.
//!
//! Nothing here is a general-purpose shell escaper. Each function encodes for
//! exactly one consumer, named in its own documentation.

/// Escapes one argument for a systemd unit's `ExecStart=`.
///
/// systemd splits on whitespace unless an argument is quoted, understands
/// `\"` and `\\` inside a double-quoted string, and — separately from all of
/// that — expands `%` specifiers anywhere in the line. A literal `%` therefore
/// has to become `%%` regardless of quoting, or a vault called `100%` would be
/// read as an unknown specifier.
pub(crate) fn systemd_argument(value: &str) -> String {
    let mut out = String::with_capacity(value.len() + 2);
    out.push('"');
    for ch in value.chars() {
        match ch {
            '"' | '\\' => {
                out.push('\\');
                out.push(ch);
            }
            '%' => out.push_str("%%"),
            _ => out.push(ch),
        }
    }
    out.push('"');
    out
}

/// Escapes one argument for the `Exec=` key of an XDG desktop entry.
///
/// Two encodings apply in sequence and both are mandatory. The `Exec` value is
/// first a command line whose reserved characters must be inside double
/// quotes, with `"`, `` ` ``, `$` and `\` backslash-escaped; the result is then
/// stored as a desktop-entry *string*, in which a backslash is itself written
/// `\\`. Applying only one of the two is the classic way to produce an
/// autostart entry that works until someone's path contains a space.
///
/// A literal `%` becomes `%%` on top of both, and quoting does not substitute
/// for it. Field codes are expanded *before* the line is split into arguments
/// and without regard to quotes, so a vault called `100% done` would reach the
/// daemon as `100done` and one called `%files` as `iles` — the "silently
/// serves the wrong directory" failure this module exists to prevent, in its
/// purest form. The same reason `systemd_argument` writes `%%`.
pub(crate) fn desktop_argument(value: &str) -> String {
    let mut quoted = String::with_capacity(value.len() + 2);
    quoted.push('"');
    for ch in value.chars() {
        if matches!(ch, '"' | '`' | '$' | '\\') {
            quoted.push('\\');
        }
        if ch == '%' {
            quoted.push('%');
        }
        quoted.push(ch);
    }
    quoted.push('"');

    // The desktop-entry string encoding, applied to the whole quoted argument.
    quoted.replace('\\', "\\\\")
}

/// Escapes text for an XML text node, as used by plists and Task Scheduler XML.
///
/// Apostrophes and quotes are escaped too. They do not need to be in a text
/// node, but a value that is safe in either position cannot be moved into an
/// attribute later and quietly become wrong.
pub(crate) fn xml_text(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for ch in value.chars() {
        match ch {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&apos;"),
            _ => out.push(ch),
        }
    }
    out
}

/// Quotes one argument for a Windows command line, per `CommandLineToArgvW`.
///
/// The rule that catches people out is that a backslash is only special *when
/// it precedes a quote*: `C:\Vault\` inside quotes would otherwise end with an
/// escaped quote and swallow the rest of the line. Runs of backslashes are
/// therefore doubled before a quote and before the closing quote, and left
/// alone everywhere else.
pub(crate) fn windows_argument(value: &str) -> String {
    if !value.is_empty() && !value.contains([' ', '\t', '"']) {
        return value.to_owned();
    }

    let mut out = String::with_capacity(value.len() + 2);
    out.push('"');
    let mut backslashes = 0usize;
    for ch in value.chars() {
        match ch {
            '\\' => backslashes += 1,
            '"' => {
                // Double the run, then escape the quote itself.
                for _ in 0..=backslashes {
                    out.push('\\');
                }
                backslashes = 0;
                out.push('"');
            }
            _ => {
                for _ in 0..backslashes {
                    out.push('\\');
                }
                backslashes = 0;
                out.push(ch);
            }
        }
    }
    // A trailing run would otherwise escape the closing quote.
    for _ in 0..backslashes * 2 {
        out.push('\\');
    }
    out.push('"');
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The paths a user actually has: spaces, Unicode, and the characters each
    /// format treats as special.
    const AWKWARD: &[&str] = &[
        "/home/user/My Bookmarks",
        "/home/user/Zakładki",
        "/home/user/书签",
        "/home/user/100% done",
        "/home/user/it's mine",
        "/home/user/say \"hi\"",
        "/home/user/back\\slash",
        "/home/user/a&b",
        "/home/user/<tag>",
        "/home/user/emoji 📚",
    ];

    #[test]
    fn a_systemd_argument_is_always_one_argument() {
        for path in AWKWARD {
            let quoted = systemd_argument(path);
            assert!(quoted.starts_with('"') && quoted.ends_with('"'), "{quoted}");
            // The interior may not contain an unescaped quote, which is what
            // would end the argument early.
            let inner = &quoted[1..quoted.len() - 1];
            let mut chars = inner.chars().peekable();
            while let Some(ch) = chars.next() {
                if ch == '\\' {
                    chars.next();
                } else {
                    assert_ne!(ch, '"', "unescaped quote in {quoted}");
                }
            }
        }
    }

    #[test]
    fn a_systemd_argument_escapes_the_specifier_marker() {
        // Not escaping this makes `%d` a specifier systemd expands to
        // something else entirely.
        assert_eq!(systemd_argument("100%"), "\"100%%\"");
        assert_eq!(systemd_argument("%d"), "\"%%d\"");
    }

    #[test]
    fn a_systemd_argument_escapes_quotes_and_backslashes() {
        assert_eq!(systemd_argument("say \"hi\""), "\"say \\\"hi\\\"\"");
        assert_eq!(systemd_argument("back\\slash"), "\"back\\\\slash\"");
    }

    #[test]
    fn a_desktop_argument_applies_both_encodings() {
        // Quoted for the command line, then backslash-escaped for the
        // desktop-entry string: one backslash becomes four.
        assert_eq!(desktop_argument("back\\slash"), "\"back\\\\\\\\slash\"");
        assert_eq!(desktop_argument("a b"), "\"a b\"");
        assert_eq!(desktop_argument("$HOME"), "\"\\\\$HOME\"");
    }

    #[test]
    fn a_desktop_argument_escapes_the_field_code_marker() {
        // Field codes are expanded before the line is split and regardless of
        // quoting, so a bare `%` is dropped along with the character after it.
        assert_eq!(desktop_argument("100% done"), "\"100%% done\"");
        assert_eq!(desktop_argument("%f"), "\"%%f\"");
        assert_eq!(desktop_argument("%"), "\"%%\"");
    }

    #[test]
    fn a_desktop_argument_never_leaves_a_bare_reserved_character() {
        for path in AWKWARD {
            let quoted = desktop_argument(path);
            assert!(quoted.starts_with('"') && quoted.ends_with('"'), "{quoted}");
        }
    }

    #[test]
    fn xml_text_escapes_every_character_that_could_close_an_element() {
        assert_eq!(xml_text("a&b"), "a&amp;b");
        assert_eq!(xml_text("</string>"), "&lt;/string&gt;");
        assert_eq!(xml_text("it's \"x\""), "it&apos;s &quot;x&quot;");
        // Unicode is left alone: the documents declare UTF-8.
        assert_eq!(xml_text("书签 📚"), "书签 📚");
    }

    #[test]
    fn a_windows_argument_leaves_a_simple_value_bare() {
        assert_eq!(windows_argument("serve"), "serve");
        assert_eq!(windows_argument("--vault"), "--vault");
    }

    #[test]
    fn a_windows_argument_quotes_a_path_with_spaces() {
        assert_eq!(
            windows_argument(r"C:\Users\A B\Vault"),
            r#""C:\Users\A B\Vault""#
        );
    }

    #[test]
    fn a_windows_argument_doubles_a_trailing_backslash_run() {
        // Without this the closing quote is escaped and the argument swallows
        // whatever follows it. Only relevant once the value needs quoting at
        // all — a trailing backslash in a value with no space is harmless bare.
        assert_eq!(windows_argument(r"C:\A B\Vault\"), r#""C:\A B\Vault\\""#);
        assert_eq!(windows_argument(r"C:\a b\\"), r#""C:\a b\\\\""#);
        assert_eq!(windows_argument(r"C:\Vault\"), r"C:\Vault\");
    }

    #[test]
    fn a_windows_argument_escapes_an_embedded_quote() {
        assert_eq!(windows_argument(r#"a "b" c"#), r#""a \"b\" c""#);
    }

    #[test]
    fn an_empty_windows_argument_becomes_an_empty_quoted_string() {
        assert_eq!(windows_argument(""), "\"\"");
    }
}
