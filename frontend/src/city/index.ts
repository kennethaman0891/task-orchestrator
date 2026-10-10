// Developer City — public entry. App lazy-imports CityView; this barrel
// exposes the view + data helpers for other parts of the app.

export { CityView, type CityViewProps } from './CityView';
export { useCityStore, visibleProjectIds } from './store';
export { useProjectsFeed } from './feed';
export { useAgentSync, mapTerminalsToBots } from './sync/agentSync';
export type { Project, AgentBot, CityNavMode, BuildingConfig, FloorSpec } from './types';
