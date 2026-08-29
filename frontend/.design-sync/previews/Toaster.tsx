import { useEffect } from "react"
import { Toaster, toast } from "kinetilearn-frontend"

// Sonner renders nothing until a toast is raised, so the preview raises a
// persistent one on mount. duration: Infinity keeps it on screen for capture.
export function Notifications() {
  useEffect(() => {
    toast.success("Class published", {
      description: "132 learners now see Security awareness 2026.",
      duration: Infinity,
    })
  }, [])

  return (
    <div className="min-h-40">
      <Toaster position="top-center" />
    </div>
  )
}
