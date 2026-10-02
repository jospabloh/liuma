import { Toaster as Sonner } from "sonner"
import { useTheme } from "@/lib/ThemeContext"

// The app's ONE toaster (mounted in App.jsx). It follows LIUMA's own theme —
// the resolved light/dark from ThemeContext, which honours the user's
// Claro/Oscuro/Sistema choice — instead of next-themes, whose provider this
// app never mounts (so it always said "system" and ignored a forced theme).
// Before this there were two toasters: shadcn's (unused) in App.jsx and a
// sonner one in Layout.jsx with no theme at all, so toasts stayed white in
// dark mode and never showed outside the Layout (login, onboarding).
const Toaster = (props) => {
  const { resolvedTheme = "light" } = useTheme() || {}

  return (
    <Sonner
      theme={resolvedTheme}
      position="top-center"
      richColors
      closeButton
      expand={false}
      // Sonner draws its close button 20x20 with a 1px border. The ::after
      // widens what a finger can hit to 44x44 without changing how it looks
      // (same trick as Switch). It is placed from the padding box, so it
      // takes 13px a side, not 12: -inset-3 gave 18 + 24 = 42px, which the
      // v1.9.0 touch scan (scripts/touch-targets-scan.mjs) caught.
      toastOptions={{
        style: { borderRadius: "12px" },
        classNames: { closeButton: "after:absolute after:-inset-[13px]" },
      }}
      {...props}
    />
  )
}

export { Toaster }
