'use client'

import Link from 'next/link'
import { Sidebar } from '@/components/Sidebar'
import { QrCode, ArrowLeft } from 'lucide-react'

/**
 * QR codes are now shown directly on the Cameras page per camera tile once streaming.
 * This page now guides users to the correct place.
 */
export default function ExamQrPage() {
  return (
    <div className="flex min-h-screen bg-drushti-surface">
      <Sidebar />
      <main className="flex-1 ml-64 p-6 flex flex-col items-center justify-center">
        <div className="max-w-md w-full text-center">
          <div className="w-16 h-16 rounded-2xl bg-drushti-navy/10 flex items-center justify-center mx-auto mb-6">
            <QrCode className="w-8 h-8 text-drushti-navy" />
          </div>
          <h1 className="text-2xl font-bold text-drushti-on mb-3">QR Code Moved</h1>
          <p className="text-drushti-muted mb-6 leading-relaxed">
            QR codes are now shown directly on the{' '}
            <strong className="text-drushti-on">Cameras</strong> page.
            Start a camera stream, then click the <strong className="text-drushti-on">QR button</strong> on
            the camera card to pair it with an exam from the mobile app.
          </p>
          <div className="flex flex-col gap-3">
            <Link
              href="/cameras"
              className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-drushti bg-drushti-navy text-white font-medium hover:opacity-90 transition-opacity"
            >
              <QrCode className="w-5 h-5" />
              Go to Cameras
            </Link>
            <Link
              href="/exams"
              className="inline-flex items-center justify-center gap-2 text-sm text-drushti-muted hover:text-drushti-navy"
            >
              <ArrowLeft className="w-4 h-4" />
              Back to Exams
            </Link>
          </div>
        </div>
      </main>
    </div>
  )
}
