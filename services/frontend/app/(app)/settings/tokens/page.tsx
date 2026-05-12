import { redirect } from 'next/navigation';

export default function SettingsTokensRedirect() {
  redirect('/profile/tokens');
}
