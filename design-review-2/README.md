# Second design exploration: 10 whole-site directions

Open `/design-review-2/`. Top controls switch among Apple.com, Orbit, Aurora, Obsidian, Prism, Titanium, Noir, Swiss Future, Nebula, and Dune. The page directory includes login, home, conversations, image creation/editing, debates, projects, project details/materials, Skills, settings, Android installation, and pitch tools. Settings include account, appearance, model services, memory, security/privacy overlays. Dedicated state controls demonstrate loading, errors/retry, empty projects, incognito and multi-image reference editing.

Each direction has a distinct layout, visual hierarchy, materials and content treatment. The Apple.com direction references the official website's measured 44px global navigation and capsule-button sizing, and its full-width product hero and black/white product-card layout. This is a visual adaptation for the AI assistant, not an Apple product.

All content and provider results are synthetic, local and in memory. The preview CSP prohibits API connections. Local file attachments are not uploaded. No production app UI, authentication, keys or provider behavior is changed. The original five-direction preview is retained at `/design-review/` for comparison.

The SVG scenes are original procedural vector design assets. They do not use paid image-generation services. Hero tilt follows an interruptible, critically damped spring and stops when idle; reduced-motion, reduced-transparency, touch capabilities and short viewports are handled explicitly.

Visual references:
- https://www.apple.com/
- https://www.apple.com/apple-intelligence/
- https://developer.apple.com/design/human-interface-guidelines/icons

Responsive browser checks do not constitute physical Android-device acceptance.

Validation: 110 desktop and 110 mobile page combinations, 60 state combinations, 40 settings sections, and every model/image settings panel were checked in the browser. Existing 125 tests passed. Additional checks cover short-height model menus, narrow/tablet layouts, local Max selection and model clamping, Google search/output modes, Grok quantity/quality, continuous reference editing, settings save, and project/debate/login operations. These are synthetic UI checks, not live provider acceptance.
