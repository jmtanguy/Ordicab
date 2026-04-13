import AppShell from '@renderer/components/shell/AppShell'
import { ToastProvider } from '@renderer/contexts/ToastContext'

function App(): React.JSX.Element {
  return (
    <ToastProvider>
      <AppShell />
    </ToastProvider>
  )
}

export default App
