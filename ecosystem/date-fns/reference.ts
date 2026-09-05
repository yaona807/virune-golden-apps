import { addDays, format, isAfter, parseISO } from 'date-fns';

const parsed = parseISO('2026-09-05T00:00:00.000Z');
const shifted = addDays(parsed, 3);

export const result = `ecosystem:date-fns:${format(shifted, 'yyyy-MM-dd')}:${isAfter(shifted, parsed)}`;
