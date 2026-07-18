import { CactusIcon } from '@phosphor-icons/react/Cactus'
import { DesktopIcon } from '@phosphor-icons/react/Desktop'
import { FirstAidKitIcon } from '@phosphor-icons/react/FirstAidKit'
import { HeadphonesIcon } from '@phosphor-icons/react/Headphones'
import { GhostIcon } from '@phosphor-icons/react/Ghost'
import { MicrophoneIcon } from '@phosphor-icons/react/Microphone'
import { MicrophoneStageIcon } from '@phosphor-icons/react/MicrophoneStage'
import { MusicNotesIcon } from '@phosphor-icons/react/MusicNotes'
import { ParkIcon } from '@phosphor-icons/react/Park'
import { PersonSimpleTaiChiIcon } from '@phosphor-icons/react/PersonSimpleTaiChi'
import { ToothIcon } from '@phosphor-icons/react/Tooth'
import { StorefrontIcon } from '@phosphor-icons/react/Storefront'
import type { EventCategory } from '../types/calendar'

interface EventCategoryDisplay {
  name: EventCategory
  shortName: string
  color: string
  icon: typeof MicrophoneIcon
}

export const eventCategoryDisplay = {
  収録: { name: '収録', shortName: '収録', color: '#c65a4e', icon: MicrophoneIcon },
  ライブ: { name: 'ライブ', shortName: 'ライ', color: '#d76645', icon: MicrophoneStageIcon },
  リハ: { name: 'リハ', shortName: 'リハ', color: '#6f8a77', icon: HeadphonesIcon },
  配信: { name: '配信', shortName: '配信', color: '#e17a2b', icon: DesktopIcon },
  歌枠: { name: '歌枠', shortName: '歌枠', color: '#ec9142', icon: MusicNotesIcon },
  歯医者: { name: '歯医者', shortName: '歯医', color: '#348783', icon: ToothIcon },
  整体: { name: '整体', shortName: '整体', color: '#4f9460', icon: PersonSimpleTaiChiIcon },
  通院: { name: '通院', shortName: '通院', color: '#43867f', icon: FirstAidKitIcon },
  おでかけ: { name: 'おでかけ', shortName: '外出', color: '#d79b3d', icon: ParkIcon },
  映: { name: '映', shortName: '映', color: '#5f7b71', icon: GhostIcon },
  その他: { name: 'その他', shortName: '他', color: '#7b817c', icon: CactusIcon },
  即売会: { name: '即売会', shortName: '即売', color: '#c96f36', icon: StorefrontIcon },
} satisfies Record<EventCategory, EventCategoryDisplay>

export const eventCategories = Object.keys(eventCategoryDisplay) as EventCategory[]

export function getEventCategoryDisplay(category: EventCategory): EventCategoryDisplay {
  return eventCategoryDisplay[category]
}
