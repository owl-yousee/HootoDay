import { CalendarDotsIcon } from '@phosphor-icons/react/CalendarDots'
import { DownloadSimpleIcon } from '@phosphor-icons/react/DownloadSimple'
import { GearIcon } from '@phosphor-icons/react/Gear'
import { HeartbeatIcon } from '@phosphor-icons/react/Heartbeat'
import { NotebookIcon } from '@phosphor-icons/react/Notebook'

const navigationItems = [
  { id: 'calendar', label: 'カレンダー', icon: CalendarDotsIcon, active: true },
  { id: 'health', label: '健康記録', icon: HeartbeatIcon, active: false },
  { id: 'records', label: '記録を見る', icon: NotebookIcon, active: false },
  { id: 'backup', label: '出力・バックアップ', icon: DownloadSimpleIcon, active: false },
  { id: 'settings', label: '設定', icon: GearIcon, active: false },
]

interface SidebarProps {
  isSettingsOpen: boolean
  onSettingsClick: () => void
}

export function Sidebar({ isSettingsOpen, onSettingsClick }: SidebarProps) {
  return (
    <aside className="sidebar">
      <p className="sidebar-label">Menu</p>
      <nav className="sidebar-nav" aria-label="メインメニュー">
        {navigationItems.map((item) => {
          const Icon = item.icon

          return (
            <button
              key={item.label}
              type="button"
              className={`nav-item${item.active ? ' is-active' : ''}`}
              aria-current={item.active ? 'page' : undefined}
              aria-expanded={item.id === 'settings' ? isSettingsOpen : undefined}
              aria-haspopup={item.id === 'settings' ? 'dialog' : undefined}
              onClick={item.id === 'settings' ? onSettingsClick : undefined}
            >
              <span className="nav-icon" aria-hidden="true">
                <Icon
                  size={21}
                  weight={item.active ? 'bold' : 'regular'}
                  aria-hidden="true"
                />
              </span>
              <span>{item.label}</span>
            </button>
          )
        })}
      </nav>
    </aside>
  )
}
