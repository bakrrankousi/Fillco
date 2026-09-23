import clsx, { type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Joins class names; later Tailwind utilities override earlier conflicting ones (e.g. w-36 beats w-full). */
export function cn(...values: ClassValue[]): string {
  return twMerge(clsx(values));
}
