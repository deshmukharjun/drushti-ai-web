import { redirect } from 'next/navigation'

// Exams are now created from the mobile app only.
export default function NewExamPage() {
  redirect('/exams')
}
