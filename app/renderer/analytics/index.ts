import { Store } from 'react-redux'
import { PersistedState } from 'redux-persist'

import { GA_HOST, GA_HEARTBEAT_INTERVAL } from 'constants/analytics'
import { IAppState } from '../reducers/index'
import { localUserId } from 'renderer/network'

import Analytics from './ga'
import appJson from 'package.json'
import { History } from 'history'
import { getPlaybackState, isPlaying } from '../lobby/reducers/mediaPlayer.helpers'
import { PlaybackState } from '../lobby/reducers/mediaPlayer'

type StoreState = IAppState & PersistedState

let analytics: Analytics
let store: Store<StoreState>

let heartbeatIntervalId: number | null = null

export async function initAnalytics(store: Store<StoreState>, history: History) {
  await sleepUntilHydrated(store)

  setupAnalytics(store)
  addSettingListener(store, () => setupAnalytics(store))

  const pageview = () => ga('pageview', { dh: GA_HOST, dp: getHistoryPath(history) })
  pageview()
  history.listen(pageview)
}

function setupAnalytics(store: Store<StoreState>) {
  stopSession()

  const state = store.getState()
  const { allowTracking } = state.settings
  if (!allowTracking) {
    console.debug('Analytics tracking disabled')
    window.ga = () => {}
    return
  }

  // https://developers.google.com/analytics/devguides/collection/protocol/v1/parameters
  const analytics = new Analytics('UA-115004557-2', {
    appName: appJson.productName,
    appVersion: appJson.version,
    clientId: localUserId()
  })

  window.ga = (...args: any[]) => {
    try {
      analytics.send(...args)
    } catch (e) {
      console.error(e)
    } finally {
      // Reset session heartbeat timer; keeps number of heartbeats sent only to
      // what's absolutely necessary to keep the session alive.
      startSession()
    }
  }
}

const startSession = () => {
  stopSession()
  heartbeatIntervalId = (setInterval(pacemaker(store), GA_HEARTBEAT_INTERVAL) as any) as number
}

const stopSession = () => {
  if (heartbeatIntervalId) {
    clearInterval(heartbeatIntervalId)
    heartbeatIntervalId = null
  }
}

async function sleepUntilHydrated(store: Store<PersistedState>) {
  return new Promise(resolve => {
    const unsubscribe = store.subscribe(() => {
      const { _persist } = store.getState()
      if (_persist && _persist.rehydrated) {
        unsubscribe()
        resolve()
      }
    })
  })
}

function addSettingListener(store: Store<IAppState>, cb: Function) {
  let prevState = store.getState()
  store.subscribe(() => {
    const state = store.getState()
    if (state.settings.allowTracking !== prevState.settings.allowTracking) {
      cb()
    }
    prevState = state
  })
}

function getHistoryPath(history: History) {
  let pathname = history.location.pathname
  if (pathname.startsWith('/lobby/') && pathname.endsWith('/create')) {
    pathname = '/lobby/join'
  }
  return pathname
}

/** Create heartbeat generator */
const pacemaker = (store: Store<IAppState>) => () => {
  if (isPlaying(store.getState())) {
    ga('event', { ec: 'app', ea: 'heartbeat', ni: 1 })
  }
}
