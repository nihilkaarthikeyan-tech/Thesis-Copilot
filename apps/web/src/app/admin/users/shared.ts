/** Types and formatters shared by the `/admin/users` pages (Next allows no extra page exports). */

export type UserRow = {
  id: string;
  email: string;
  name: string | null;
  role: string;
  plan: string;
  createdAt: string;
  lastActiveAt: string | null;
  documents: number;
  costInr: number;
  usage: Array<{ action: string; used: number; cap: number }>;
};

export const inr = (value: number) => `₹${value.toFixed(2)}`;
export const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : 'never');
