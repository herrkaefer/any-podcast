import { Store } from '@tanstack/store'

export interface PageStoreState {
  currentPage: number
}

let pageStore: Store<PageStoreState> | null = null

const createStore = () => new Store<PageStoreState>({ currentPage: 1 })

export function initPageStore(): Store<PageStoreState> {
  if (!pageStore) {
    pageStore = createStore()
  }
  return pageStore
}

export function getPageStore(): Store<PageStoreState> {
  if (!pageStore) {
    throw new Error('Page store has not been initialized')
  }
  return pageStore
}
