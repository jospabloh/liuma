import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

function read(path) {
  return fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
}

test('calendar days are selectable so agenda changes to the clicked day', () => {
  const calendar = read('src/pages/CalendarioEscolar.jsx');

  assert.match(calendar, /const \[selectedDate, setSelectedDate\] = useState\(new Date\(\)\)/);
  assert.match(calendar, /const selectedDayEvents = getEventsForDate\(selectedDate\)/);
  assert.match(calendar, /const handleDaySelect = \(day\) => \{\s*setSelectedDate\(day\);\s*\}/);
  assert.match(calendar, /onClick=\{\(\) => handleDaySelect\(day\)\}/);
  assert.match(calendar, /Agenda del día/);
});

test('calendar days expose visible hover, selected, and keyboard focus states', () => {
  const calendar = read('src/pages/CalendarioEscolar.jsx');

  assert.match(calendar, /role="button"/);
  assert.match(calendar, /tabIndex=\{0\}/);
  assert.match(calendar, /aria-pressed=\{isSelected\}/);
  assert.match(calendar, /onKeyDown=\{\(event\) => handleDayKeyDown\(event, day\)\}/);
  assert.match(calendar, /hover:-translate-y-0\.5 hover:border-brand\/30 hover:bg-brand\/10 hover:shadow-md/);
  assert.match(calendar, /focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2/);
  assert.match(calendar, /isSelected \? 'bg-brand\/10 border-brand ring-2 ring-brand\/30 shadow-md'/);
});

test('buttons and global interactive controls have visible hover and focus affordances', () => {
  const button = read('src/components/ui/button.jsx');
  const css = read('src/index.css');

  assert.match(button, /transition-all hover:shadow-md focus-visible:outline-none focus-visible:ring-2/);
  assert.match(button, /active:scale-\[0\.98\]/);
  assert.match(css, /button:not\(:disabled\),\s*\[role='button'\],\s*a\[href\]/);
  assert.match(css, /a\[href\]:focus-visible,\s*\[role='button'\]:focus-visible/);
});
