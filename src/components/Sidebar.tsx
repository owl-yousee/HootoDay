import { CalendarDotsIcon } from '@phosphor-icons/react/CalendarDots'
import { DownloadSimpleIcon } from '@phosphor-icons/react/DownloadSimple'
import { GearIcon } from '@phosphor-icons/react/Gear'
import { HeartbeatIcon } from '@phosphor-icons/react/Heartbeat'
import { NotebookIcon } from '@phosphor-icons/react/Notebook'
import { PackageIcon } from '@phosphor-icons/react/Package'

const navigationItems = [
  { id: 'calendar', label: 'カレンダー', mobileLabel: '予定', icon: CalendarDotsIcon },
  { id: 'health', label: '健康記録', mobileLabel: '健康', icon: HeartbeatIcon },
  { id: 'records', label: '記録を見る', mobileLabel: '記録', icon: NotebookIcon },
  { id: 'inventory', label: '販売・在庫', mobileLabel: '販売', icon: PackageIcon },
  { id: 'backup', label: '出力・バックアップ', mobileLabel: '出力', icon: DownloadSimpleIcon },
  { id: 'settings', label: '設定', mobileLabel: '設定', icon: GearIcon },
]

export type AppView = 'calendar' | 'health' | 'records' | 'inventory' | 'export'

interface SidebarProps {
  activeView: AppView
  isSettingsOpen: boolean
  onViewChange: (view: AppView) => void
  onSettingsClick: () => void
}

export function Sidebar({ activeView, isSettingsOpen, onViewChange, onSettingsClick }: SidebarProps) {
  const renderNavigation = (className: string, ariaLabel: string, isMobile = false) => (
    <nav className={className} aria-label={ariaLabel}>
        {navigationItems.map((item) => {
          const Icon = item.icon
          const isViewItem = item.id === 'calendar' || item.id === 'health' || item.id === 'records' || item.id === 'inventory' || item.id === 'backup'
          const view = item.id === 'backup' ? 'export' : item.id
          const isActive = isViewItem && view === activeView && !(isMobile && item.id === 'backup')

          return (
            <button
              key={item.label}
              type="button"
              className={`nav-item${item.id === 'backup' ? ' nav-item-export' : ''}${isActive ? ' is-active' : ''}`}
              aria-label={item.label}
              aria-current={isActive ? 'page' : undefined}
              aria-expanded={item.id === 'settings' ? isSettingsOpen : undefined}
              aria-haspopup={item.id === 'settings' ? 'dialog' : undefined}
              onClick={item.id === 'settings'
                ? onSettingsClick
                : isViewItem
                  ? () => onViewChange(view as AppView)
                  : undefined}
            >
              <span className="nav-icon" aria-hidden="true">
                <Icon
                  size={21}
                  weight={isActive ? 'bold' : 'regular'}
                  aria-hidden="true"
                />
              </span>
              <span className="nav-label nav-label-full" aria-hidden="true">
                {item.label}
              </span>
              <span className="nav-label nav-label-mobile" aria-hidden="true">
                {item.mobileLabel}
              </span>
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
        {renderNavigation('mobile-navigation-list', '狭い画面用メインメニュー', true)}
      </div>
    </>
  )
}
