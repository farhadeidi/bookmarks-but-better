# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [3.0.0] - 2026-03-29

### Added

- Drag-and-drop bookmark sorting with support for reordering within and across folders
- Folder order dialog for rearranging folder tabs via drag-and-drop
- Create folder button for quick folder management
- Custom scrollbar styling using ScrollArea component
- Email clients added to default seed bookmarks
- `clipboardWrite` permission for copy-to-clipboard functionality

### Changed

- Updated grid view default column layout
- Improved performance: memoized components, lazy-loaded dialogs, eliminated double-refresh on startup

### Fixed

- Bookmark links no longer open in a new tab unexpectedly
- Same-folder drag reorder offset in Chrome adapter
- Drop indicator duplication in grid layout
- Native drag interference on links and images inside bookmark cards

### Removed

- Unused dependencies cleaned up

## [2.1.0] - 2026-03-26

### Added

- Folder actions: rename, delete, and reorder folders
- Layout settings for customizing bookmark grid columns
- GitHub issue templates for bug reports and feature requests

## [2.0.0] - 2026-03-24

### Added

- First-run onboarding wizard with welcome, root folder selection, appearance, and done steps
- Theme grid with mode toggle in onboarding
- Curated seed bookmarks for new users
- Bookmark logo and comprehensive icon set
- "Show in bookmark manager" action on bookmark cards
- Google Favicon V2 for higher quality site icons
- Chrome Web Store listing and promotional assets
- MIT License

### Fixed

- Favicon rendering on HiDPI displays (64px request)
- Wizard step edge bleed during slide animations
- Folder label shown instead of ID in select trigger
- Host permissions for Google favicon services

### Changed

- Rewrote README for end users with screenshots and badges

[3.0.0]: https://github.com/farhadeidi/bookmarks-but-better/compare/v2.1.0...v3.0.0
[2.1.0]: https://github.com/farhadeidi/bookmarks-but-better/compare/v2.0.0...v2.1.0
[2.0.0]: https://github.com/farhadeidi/bookmarks-but-better/releases/tag/v2.0.0
