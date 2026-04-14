/** Row shape for public.exams (DrushtiAI / Android parity). */
export type ExamRow = {
  id: string
  user_id: string
  subject: string
  exam_date: string
  exam_time: string
  student_count: number
  room_notes: string | null
  status: string
  camera_connected: boolean
  linked_device_id: string | null
  created_at: string
  updated_at: string
}
