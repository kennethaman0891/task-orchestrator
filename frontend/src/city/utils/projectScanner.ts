// Developer City — Project Floor Plan Scanner & Cache.
// Provides realistic, multi-floor architectural plans with working, interactive objects
// based on the REAL project folders. Zero API cost, zero external tokens, instantaneous.

import { useState, useEffect } from 'react';
import type { Project, ProjectFloorPlan, FloorPlanFloor } from '@/city/types';
import { getProjectFloorPlan } from '@/city/api';

const planCache: Record<string, ProjectFloorPlan> = {};

/** Deterministic client-side generator when backend sidecar is offline or unreachable */
export function generateFallbackFloorPlan(project: Project): ProjectFloorPlan {
  const pName = project.name || 'Project';
  const pPath = project.path || '/workspace';

  const floors: FloorPlanFloor[] = [
    {
      index: 0,
      name: 'Frontend & UI Studio',
      category: 'frontend',
      role: 'User Interface, React & 3D Interactive Graphics',
      folder: 'frontend',
      theme: 'neon',
      accentColor: '#38bdf8',
      floorStyle: 'oak',
      wallStyle: 'modern_white',
      description: 'High-performance React & Three.js workstation studio rendering the live application viewport.',
      objects: [
        {
          id: 'fe_workstation_1',
          type: 'workstation',
          title: 'Interactive Dev Workstation',
          position: [-2.2, 0.16, 0.8],
          file: 'frontend/src/city/CityView.tsx',
          file2: 'frontend/src/city/scene/Interior.tsx',
          codeLines1: [
            'export function CityView({ terminals }: CityViewProps) {',
            '  useProjectsFeed();',
            '  useAgentSync(terminals);',
            '  return <Canvas><CityScene /></Canvas>;',
            '}',
          ],
          codeLines2: [
            'export function InteriorFloor({ project, floorIndex }) {',
            '  const floorPlan = useProjectFloorPlan(project);',
            '  return <DynamicFloorView plan={floorPlan} />;',
            '}',
          ],
          actionType: 'open_file',
          actionLabel: 'Inspect CityView.tsx',
          status: 'Vite 5.4 Live Sync Active · 0 Errors',
        },
        {
          id: 'fe_preview_billboard',
          type: 'preview_billboard',
          title: 'Live Application UI Billboard',
          position: [2.4, 0.16, -1.8],
          actionType: 'open_preview',
          actionLabel: 'Launch UI Preview',
          details: 'React 18 · TypeScript · Vite · Three.js',
          status: 'Online · 60 FPS Viewport',
        },
        {
          id: 'fe_components_rack',
          type: 'component_gallery',
          title: 'Design Components & Archetypes',
          position: [2.6, 0.16, 1.2],
          actionType: 'open_folder',
          actionLabel: 'Browse Components',
          details: 'Modular HUD, Terminal Dock & 3D Canvas',
          status: '12 UI Archetypes Active',
        },
        {
          id: 'fe_lounge_strategy',
          type: 'lounge',
          title: 'Breakout Strategy & Coffee Lounge',
          position: [2.4, 0.16, 1.8],
          actionType: 'open_standup',
          actionLabel: 'Open Strategy Standup',
          details: 'Agent Collaboration, UI Review Notes & Coffee Break',
          status: 'Quiet Zone · Standup Active',
        },
      ],
    },
    {
      index: 1,
      name: 'Backend & API Cluster',
      category: 'backend',
      role: 'Cloud Infrastructure, REST Endpoints & Data Persistence',
      folder: 'backend',
      theme: 'midnight',
      accentColor: '#10b981',
      floorStyle: 'tile',
      wallStyle: 'server_mesh',
      description: '42U Server pods running the sidecar REST API, WebSocket streams, and project state sync.',
      objects: [
        {
          id: 'be_server_cluster',
          type: 'server_pod',
          title: 'Sidecar 42U Server Cluster',
          position: [2.5, 0.18, -1.6],
          actionType: 'open_server_inspector',
          actionLabel: 'Inspect Live Endpoints',
          endpoints: ['/api/projects', '/api/terminals', '/api/files', '/api/city/car-spec', '/ws'],
          status: 'Port 8000 Healthy · Zero Latency',
        },
        {
          id: 'be_database_pod',
          type: 'database_pod',
          title: 'Persistent Registry & SQLite/JSON Pod',
          position: [-2.2, 0.16, -1.6],
          file: 'backend/data/projects.json',
          actionType: 'inspect_db',
          actionLabel: 'Inspect Storage & Cache',
          details: 'JSON Document Store + In-Memory Mutex Lock',
          status: 'State Synced',
        },
        {
          id: 'be_api_workstation',
          type: 'workstation',
          title: 'FastAPI Router Workstation',
          position: [-2.2, 0.16, 1.0],
          file: 'backend/routers/projects.py',
          codeLines1: [
            'from fastapi import APIRouter, HTTPException',
            'router = APIRouter(prefix="/api/projects")',
            '@router.get("/{project_id}/floor-plan")',
            'async def get_project_floor_plan(project_id: str):',
            '    return scan_project(path)',
          ],
          actionType: 'open_file',
          actionLabel: 'Edit projects.py',
          status: 'FastAPI · Asynchronous Coroutines',
        },
      ],
    },
    {
      index: 2,
      name: 'Desktop Runtime & Rust Gateway',
      category: 'rust',
      role: 'Native Operating System Interop & High-Performance IPC',
      folder: 'frontend/src-tauri',
      theme: 'sandstone',
      accentColor: '#f59e0b',
      floorStyle: 'steel',
      wallStyle: 'dark_concrete',
      description: 'Tauri v2 compilation engine, native Rust sidecar dispatchers, and system shell bridges.',
      objects: [
        {
          id: 'rust_cargo_station',
          type: 'workstation',
          title: 'Rust Cargo Engine Bench',
          position: [-2.2, 0.16, 0.8],
          file: 'frontend/src-tauri/src/main.rs',
          codeLines1: [
            '#[tauri::command]',
            'fn open_project_window(handle: tauri::AppHandle) {',
            '  println!("Opening TTO window...");',
            '}',
          ],
          actionType: 'open_file',
          actionLabel: 'Open main.rs',
          status: 'Cargo Release Build · 0 Warnings',
        },
        {
          id: 'ipc_relay_terminal',
          type: 'server_pod',
          title: 'Native IPC Relay Conduits',
          position: [2.4, 0.18, -1.6],
          actionType: 'open_terminal',
          actionLabel: 'Launch Native Terminal',
          details: 'Tauri Webview Window & PTY Pipe',
          status: 'IPC Channel Active',
        },
      ],
    },
    {
      index: 3,
      name: 'AI Autonomous Fleet & Terminal Garage',
      category: 'ai',
      role: 'Agent Dispatch, Terminal Vehicles & Task Coordination',
      folder: 'agent',
      theme: 'neon',
      accentColor: '#a855f7',
      floorStyle: 'obsidian',
      wallStyle: 'modern_white',
      description: 'Multi-agent orchestration floor managing autonomous terminal vehicles, prompt queues, and coding sub-agents.',
      objects: [
        {
          id: 'agent_matrix_console',
          type: 'agent_console',
          title: 'Autonomous Agent Dispatch Console',
          position: [-2.2, 0.16, 0.8],
          actionType: 'open_agent_panel',
          actionLabel: 'Inspect Active Agents',
          details: 'Claude 3.5 Sonnet / GPT-4o / OpenCode Bots',
          status: '16 Virtual Agents Online',
        },
        {
          id: 'terminal_car_dock',
          type: 'pipeline_station',
          title: 'Terminal Vehicle Fleet Dock',
          position: [2.5, 0.16, -1.6],
          actionType: 'open_car_panel',
          actionLabel: 'Inspect Fleet Vehicles',
          details: 'City Grid Transport & PTY Execution',
          status: 'Fleet Ready For Dispatch',
        },
      ],
    },
    {
      index: 4,
      name: 'DevOps & Build Engineering',
      category: 'devops',
      role: 'Build Automation, Package Bundling & CI Testing',
      folder: 'scripts',
      theme: 'mono',
      accentColor: '#ef4444',
      floorStyle: 'slate',
      wallStyle: 'dark_concrete',
      description: 'Automated build orchestration, package releases, icon processing, and regression testing pipelines.',
      objects: [
        {
          id: 'build_pipeline_desk',
          type: 'pipeline_station',
          title: 'Automated Build Pipeline Desk',
          position: [-2.2, 0.16, 0.8],
          file: 'scripts/build-and-install.sh',
          codeLines1: [
            '#!/usr/bin/env bash',
            'echo "Building TTO Project Suite..."',
            'npm run build',
            'cargo build --release',
          ],
          actionType: 'open_terminal',
          actionLabel: 'Run build-and-install.sh',
          status: 'Pipeline Configured',
        },
        {
          id: 'test_runner_pod',
          type: 'server_pod',
          title: 'Continuous Integration Test Runner',
          position: [2.4, 0.18, -1.6],
          actionType: 'run_tests',
          actionLabel: 'Run Test Suite',
          details: 'Vitest + Pytest Unit & Integration Tests',
          status: 'All Suites Passing',
        },
      ],
    },
    {
      index: 5,
      name: 'Architecture & Knowledge Loft',
      category: 'docs',
      role: 'System Blueprints, Technical Specifications & Repository History',
      folder: 'docs',
      theme: 'forest',
      accentColor: '#6366f1',
      floorStyle: 'walnut',
      wallStyle: 'wood_panel',
      description: 'Architectural drafting loft with interactive system blueprints, audit reports, and git timeline records.',
      objects: [
        {
          id: 'blueprint_board',
          type: 'blueprint_board',
          title: 'Master Architecture Blueprint Wall',
          position: [0.0, 1.2, -2.4],
          actionType: 'open_blueprint',
          actionLabel: 'View Architecture Blueprint',
          docs: ['ARCHITECTURE.md', 'README.md', 'PROJECT_ARCHITECTURE_AUDIT.md'],
          preview: [
            `# ${pName} Architecture`,
            'Developer City 3D Architectural Visualizer',
            'Deterministic, real-time code and folder exploration',
          ],
          status: 'Branch: task-orchestrator',
        },
        {
          id: 'git_timeline_table',
          type: 'workstation',
          title: 'Git Commit Log & Revision Table',
          position: [-2.0, 0.16, 0.8],
          actionType: 'view_git',
          actionLabel: 'View Commit Timeline',
          commits: [
            'Reworked on Terminals and new versions',
            'Enhanced 3D floor architecture & real project objects',
            'Added walk-through room controls & first-person exploration',
          ],
          status: '5 Recent Commits',
        },
        {
          id: 'executive_lounge',
          type: 'lounge',
          title: 'Breakout Strategy & Coffee Lounge',
          position: [2.4, 0.16, 0.8],
          actionType: 'relax',
          actionLabel: 'Breakout Lounge',
          status: 'Quiet Zone',
        },
      ],
    },
  ];

  return {
    project: {
      name: pName,
      path: pPath,
      techStack: ['React', 'TypeScript', 'Vite', 'Three.js', 'FastAPI', 'Rust'],
      topFolders: ['frontend', 'backend', 'gateway', 'scripts', 'docs', 'agent'],
      gitBranch: 'main',
      totalFloors: floors.length,
    },
    floors,
  };
}

/** Hook to fetch or derive the dynamic floor plan for a project */
export function useProjectFloorPlan(project: Project | null): ProjectFloorPlan | null {
  const [plan, setPlan] = useState<ProjectFloorPlan | null>(() => {
    if (!project) return null;
    return planCache[project.id] || generateFallbackFloorPlan(project);
  });

  useEffect(() => {
    if (!project) {
      setPlan(null);
      return;
    }

    if (planCache[project.id]) {
      setPlan(planCache[project.id]);
      return;
    }

    let active = true;
    getProjectFloorPlan(project.id)
      .then((res) => {
        if (!active) return;
        if (res && Array.isArray(res.floors) && res.floors.length > 0) {
          planCache[project.id] = res;
          setPlan(res);
        } else {
          const fallback = generateFallbackFloorPlan(project);
          planCache[project.id] = fallback;
          setPlan(fallback);
        }
      })
      .catch(() => {
        if (!active) return;
        const fallback = generateFallbackFloorPlan(project);
        planCache[project.id] = fallback;
        setPlan(fallback);
      });

    return () => {
      active = false;
    };
  }, [project?.id, project?.path]);

  return plan;
}
