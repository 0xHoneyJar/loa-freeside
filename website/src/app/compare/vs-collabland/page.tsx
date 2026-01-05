import { redirect } from 'next/navigation';

// Redirect old comparison URL to new extension page
export default function VsCollabLandPage() {
  redirect('/collab-land');
}
