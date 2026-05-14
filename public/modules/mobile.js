import { $ } from './helpers.js';

export const isMobile = () => window.matchMedia('(max-width: 768px)').matches;

export function openMobileSidebar() {
  $('panel-left').classList.add('mobile-open');
  $('mobile-overlay').classList.add('active');
}

export function closeMobileSidebar() {
  $('panel-left')?.classList.remove('mobile-open');
  $('mobile-overlay')?.classList.remove('active');
}

// ── Event wiring ──────────────────────────────────────────────────────────────

$('btn-hamburger').addEventListener('click', openMobileSidebar);
$('btn-close-sidebar').addEventListener('click', closeMobileSidebar);
$('mobile-overlay').addEventListener('click', closeMobileSidebar);

// Quick-nav buttons also close the sidebar on mobile (navigate() handles the rest)
$('btn-staging').addEventListener('click', closeMobileSidebar);
$('btn-library').addEventListener('click', closeMobileSidebar);
