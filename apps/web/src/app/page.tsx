import { redirect } from 'next/navigation';

export default function HomePage() {
  // The ranking is what the operator opens the console for; the merge queue is
  // maintenance they reach when the ranking says evidence is missing.
  redirect('/targets');
}
