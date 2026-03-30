# UI Redesign: Mondays-Style Clean Interface

## Design Direction
Redesign the entire frontend to match Monday.com's design language: light theme, clean white backgrounds, minimal borders, generous whitespace, Figtree font, SVG line icons (no emojis), NIWC Dark color palette.

## Color Palette
- **Primary**: `#1b2a4a` (NIWC Dark) — sidebar logo, page titles
- **Accent**: `#4a90d9` — buttons, active tab indicator, links, interactive elements
- **Accent hover**: `#3a7bc8`
- **Secondary accent**: `#2c4a7c` — darker interactive states
- **Background**: `#f6f7fb` — page background
- **Surface**: `#ffffff` — cards, sidebar, topbar
- **Border**: `#e6e9ef` — subtle separators
- **Text primary**: `#323338` — headings, body
- **Text secondary**: `#676879` — nav items, labels
- **Text muted**: `#b0b3bd` — metadata, counts
- **Status green**: `#00c875` / bg `#e8f5e9` — Approved
- **Status orange**: `#fdab3d` / bg `#fff3e0` — Analyzed
- **Status blue**: `#4a90d9` / bg `#e3f2fd` — Uploaded

## Dark Mode
Same layout, inverted palette:
- Background: `#1a1a2e`
- Surface: `#222236`
- Border: `#2d2d44`
- Text primary: `#e8e8ed`
- Text secondary: `#9898a8`
- Toggle in sidebar bottom or topbar

## Typography
- **Font**: Figtree (Google Fonts)
- **Weights**: 400 (body), 500 (emphasis/nav), 600 (page titles only)
- **No 700/bold anywhere**
- **Sizes**: 20px page title, 14px body, 13px buttons/tabs, 12px metadata/muted, 11px badges

## Icons
- SVG line icons only (Lucide React) — no emojis anywhere
- Stroke width: 1.8, size: 15-18px

## Page Structure (2 main views)

### 1. Dashboard (Home) — `/`
- **Sidebar** (240px, white): Logo, nav (Meetings/Chat/Documents), Tags section, Settings/Help at bottom
- **Topbar** (52px, white): Search box with cmd+F shortcut, Upload Meeting split button (accent blue, compact), notification bell, avatar, dark mode toggle
- **Content**: Page title "All Meetings", tab row (All/Recent/Approved/Needs Review), Filter/Sort toolbar, meeting list
- **Meeting rows**: accent bar (colored by status), title, date+duration meta, stats (decisions/links counts as SVG icons), avatar stack, status pill, three-dot menu
- History page removed — dashboard IS the meeting list

### 2. Meeting Detail — `/meeting/:id`
- Same sidebar + topbar
- Content area: meeting header (title, meta), then tabbed content:
  - **Analysis tab**: decisions, action items, risks in clean card list (not the current dense review)
  - **Transcript tab**: clean transcript view with search + highlighting
  - **Chat tab**: embedded chat for this meeting (replaces separate chat page)
- Approve & Export in topbar area for this page

### Removed/Hidden
- Live Session: hidden from nav (Phase 3)
- Prep View: accessible from meeting detail, not top-level
- Separate History page: merged into dashboard
- Separate Chat page: merged into meeting detail as tab

## Component Changes
- Replace all glassmorphism/glow effects with flat white cards + subtle borders
- Replace dark theme CSS variables with light theme
- Remove all emoji usage in UI
- Replace custom icons with Lucide React SVGs
- Add dark mode CSS variables + toggle component

## Implementation Notes
- Keep React 19 + Vite + TypeScript + Tailwind + shadcn/ui stack
- Replace index.css color variables entirely
- Add Figtree font via @fontsource or Google Fonts
- Sidebar as a layout component wrapping all routes
- Dark mode via CSS class toggle on `<html>` element + localStorage persistence
