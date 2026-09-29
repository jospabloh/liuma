import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '@/App.jsx'
import '@/index.css'
import { rememberInviteCode } from '@/lib/onboarding/joinCode'

// An invitation link (/?codigo=ABCD-EFGH) must survive the redirect to /login
// and back — see rememberInviteCode.
rememberInviteCode(window.location.search)

ReactDOM.createRoot(document.getElementById('root')).render(
  <App />
)
