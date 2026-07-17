import { CalendarDotsIcon } from '@phosphor-icons/react/CalendarDots'
import { DownloadSimpleIcon } from '@phosphor-icons/react/DownloadSimple'
import { GearIcon } from '@phosphor-icons/react/Gear'
import { HeartbeatIcon } from '@phosphor-icons/react/Heartbeat'
import { NotebookIcon } from '@phosphor-icons/react/Notebook'

const navigationItems = [
  { id: 'calendar', label: 'カレンダー', icon: CalendarDotsIcon },
  { id: 'health', label: '健康記録', icon: HeartbeatIcon },
  { id: 'records', label: '記録を見る', icon: NotebookIcon },
  { id: 'backup', label: '出力・バックアップ', icon: DownloadSimpleIcon },
  { id: 'settings', label: '設定', icon: GearIcon },
]

export type AppView = 'calendar' | 'health'

interface SidebarProps {
  activeView: AppView
  isSettingsOpen: boolean
  onViewChange: (view: AppView) => void
  onSettingsClick: () => void
}

export function Sidebar({ activeView, isSettingsOpen, onViewChange, onSettingsClick }: SidebarProps) {
  const renderNavigation = (className: string, ariaLabel: string) => (
    <nav className={className} aria-label={ariaLabel}>
        {navigationItems.map((item) => {
          const Icon = item.icon
          const isViewItem = item.id === 'calendar' || item.id === 'health'
          const isActive = isViewItem && item.id === activeView

          return (
            <button
              key={item.label}
              type="button"
              className={`nav-item${isActive ? ' is-active' : ''}`}
              aria-label={item.label}
              aria-current={isActive ? 'page' : undefined}
              aria-expanded={item.id === 'settings' ? isSettingsOpen : undefined}
              aria-haspopup={item.id === 'settings' ? 'dialog' : undefined}
              onClick={item.id === 'settings'
                ? onSettingsClick
                : isViewItem
                  ? () => onViewChange(item.id as AppView)
                  : undefined}
            >
              <span className="nav-icon" aria-hidden="true">
                <Icon
                  size={21}
                  weight={isActive ? 'bold' : 'regular'}
                  aria-hidden="true"
                />
              </span>
              <span className="nav-label">{item.label}</span>
              <span className="nav-tooltip" aria-hidden="true">{item.label}</span>
            </button>
          )
        })}
    </nav>
  )

  return (
    <>
      <aside className="sidebar">
        {renderNavigation('sidebar-nav', 'メインメニュー')}
      </aside>
      <div className="mobile-navigation">
        {renderNavigation('mobile-navigation-list', '狭い画面用メインメニュー')}
      </div>
    </>
  )
}
