export const preferenceKeys = (demo: boolean) => ({
  merge: demo ? 'demo-merge-preferences' : 'merge-preferences',
  actions: demo ? 'demo-actions' : 'actions',
  views: demo ? 'demo-views' : 'views',
  collapsed: 'collapsed',
  filter: 'filter',
})
