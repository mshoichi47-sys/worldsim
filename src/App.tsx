import { Game } from './components/Game'
import { Home } from './components/Home'
import { useApp } from './store'

export default function App() {
  const screen = useApp((s) => s.screen)
  return screen === 'game' ? <Game /> : <Home />
}
