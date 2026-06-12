import './styles.css';
import { Store } from './store/store';
import { DexieStorage } from './storage/dexie';
import { h, toast } from './ui/components';
import { viewEvents } from './ui/view-events';
import { viewSeatMap } from './ui/view-seatmap';
import { viewBuyers } from './ui/view-buyers';
import { viewAssign } from './ui/view-assign';
import { viewReview } from './ui/view-review';
import { viewExport } from './ui/view-export';

type StepId = 'events' | 'map' | 'buyers' | 'assign' | 'review' | 'export';

interface Step {
  id: StepId;
  num: number;
  label: string;
  title: string;
  hint: string;
  needsEvent: boolean;
  make: (store: Store) => { el: HTMLElement; update: () => void };
  done: (store: Store) => boolean;
}

const store = new Store(new DexieStorage());

const STEPS: Step[] = [
  {
    id: 'events', num: 1, label: 'Event', title: 'Your events',
    hint: 'Pick the event you are working on, or create a new one.',
    needsEvent: false,
    make: (s) => viewEvents(s, () => go('map')),
    done: (s) => !!s.state,
  },
  {
    id: 'map', num: 2, label: 'Seat Map', title: 'Set up the venue',
    hint: 'Paste the seat layout from Google Sheets, then fine-tune seats on the map.',
    needsEvent: true,
    make: viewSeatMap,
    done: (s) => !!s.state && s.state.seatOrder.length > 0,
  },
  {
    id: 'buyers', num: 3, label: 'Buyers', title: 'Import ticket buyers',
    hint: 'Upload the buyer list exported from Retool.',
    needsEvent: true,
    make: viewBuyers,
    done: (s) => !!s.state && Object.keys(s.state.buyers).length > 0,
  },
  {
    id: 'assign', num: 4, label: 'Assign', title: 'Assign seats',
    hint: 'Let the app place every booking together, preview, then confirm.',
    needsEvent: true,
    make: viewAssign,
    done: (s) => !!s.state && Object.keys(s.state.assignments).length > 0,
  },
  {
    id: 'review', num: 5, label: 'Review', title: 'Review & approve',
    hint: 'Check the result, fix seats by hand, then approve to lock them.',
    needsEvent: true,
    make: viewReview,
    done: (s) => !!s.state && Object.values(s.state.assignments).some((a) => a.status !== 'assigned'),
  },
  {
    id: 'export', num: 6, label: 'Export', title: 'Send to Retool',
    hint: 'Download the upload file for approved seats.',
    needsEvent: true,
    make: viewExport,
    done: (s) => !!s.state && Object.values(s.state.assignments).some((a) => a.status === 'uploaded'),
  },
];

let currentStep: StepId = 'events';
let currentView: { el: HTMLElement; update: () => void } | null = null;

const app = document.getElementById('app')!;
const stepsList = h('ul', { class: 'steps' });
const eventBadge = h('div', { class: 'sidebar-event' }, 'No event open');
const topTitle = h('h2', {}, '');
const topHint = h('span', { class: 'hint' }, '');
const undoBtn = h('button', { class: 'btn', style: 'font-size:12.5px;padding:5px 12px', onClick: async () => {
  const desc = store.describeLast();
  if (!desc) return;
  await store.undo();
  toast(`Undone: ${desc}`, 'info');
} }, '↩ Undo');
const content = h('div', { class: 'content' });

const sidebar = h('div', { class: 'sidebar' },
  h('div', { class: 'sidebar-brand' }, 'Seat Assignment', h('small', {}, 'TipTip internal tool')),
  eventBadge,
  stepsList,
  h('div', { class: 'sidebar-foot' }, 'All changes are saved automatically on this computer.'),
);
const main = h('div', { class: 'main' },
  h('div', { class: 'topbar' }, topTitle, topHint, undoBtn),
  content,
);
app.append(sidebar, main);

function renderSidebar(): void {
  stepsList.innerHTML = '';
  for (const step of STEPS) {
    const disabled = step.needsEvent && !store.state;
    const li = h('li', {
      class: [
        currentStep === step.id ? 'active' : '',
        disabled ? 'disabled' : '',
        step.done(store) ? 'done' : '',
      ].join(' '),
      onClick: () => {
        if (!disabled) go(step.id);
      },
    },
      h('span', { class: 'step-num' }, step.done(store) ? '✓' : String(step.num)),
      step.label,
    );
    stepsList.append(li);
  }
  eventBadge.textContent = store.state ? `🎫 ${store.state.info.name}` : 'No event open';
}

function go(stepId: StepId): void {
  const step = STEPS.find((s) => s.id === stepId)!;
  currentStep = stepId;
  topTitle.textContent = `${step.num}. ${step.title}`;
  topHint.textContent = step.hint;
  currentView = step.make(store);
  content.innerHTML = '';
  content.classList.toggle('no-pad', false);
  content.append(currentView.el);
  renderSidebar();
}

store.subscribe(() => {
  renderSidebar();
  const desc = store.describeLast();
  (undoBtn as HTMLButtonElement).disabled = !desc;
  undoBtn.title = desc ? `Undo: ${desc}` : 'Nothing to undo';
  currentView?.update();
});

store.init().then(() => {
  go('events');
});
