import { CalendarDotsIcon } from '@phosphor-icons/react/CalendarDots'
import { DownloadSimpleIcon } from '@phosphor-icons/react/DownloadSimple'
import { GearIcon } from '@phosphor-icons/react/Gear'
import { HeartbeatIcon } from '@phosphor-icons/react/Heartbeat'
import { NotebookIcon } from '@phosphor-icons/react/Notebook'

const navigationItems = [
  { label: 'カレンダー', icon: CalendarDotsIcon, active: true },
  { label: '健康記録', icon: HeartbeatIcon, active: false },
  { label: '記録を見る', icon: NotebookIcon, active: false },
  { label: '出力・バックアップ', icon: DownloadSimpleIcon, active: false },
  { label: '設定', icon: GearIcon, active: false },
]

export function Sidebar() {
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
