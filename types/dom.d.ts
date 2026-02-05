interface Document {
  startViewTransition?: (callback: () => void | Promise<void>) => void
}
