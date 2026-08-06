import type { ComponentType } from "react";
import {
  Activity,
  Boxes,
  FolderOpen,
  Home,
  Library,
  Settings,
  Sparkles,
} from "lucide-react";

import type { SectionId } from "../types";

interface NavigationItem {
  id: SectionId;
  label: string;
  icon: ComponentType<{ size?: number; strokeWidth?: number }>;
}

const navigation: NavigationItem[] = [
  { id: "home", label: "Home", icon: Home },
  { id: "library", label: "Libreria", icon: Library },
  { id: "studio", label: "Studio", icon: Sparkles },
  { id: "workflows", label: "Workflow", icon: Boxes },
  { id: "activity", label: "Attività", icon: Activity },
  { id: "models", label: "Modelli", icon: FolderOpen },
  { id: "settings", label: "Impostazioni", icon: Settings },
];

interface SidebarProps {
  active: SectionId;
  jobCount: number;
  onNavigate: (section: SectionId) => void;
}

export function Sidebar({ active, jobCount, onNavigate }: SidebarProps) {
  return (
    <aside className="sidebar">
      <div className="brand" aria-label="Local AI Desk">
        <span className="brand-mark" aria-hidden="true">
          L/AI
        </span>
        <span className="brand-copy">
          <strong>Local AI Desk</strong>
          <small>Foundation 2.0</small>
        </span>
      </div>

      <nav className="primary-nav" aria-label="Navigazione principale">
        {navigation.map((item) => {
          const Icon = item.icon;
          const isActive = active === item.id;
          return (
            <button
              aria-current={isActive ? "page" : undefined}
              className="nav-item"
              data-active={isActive}
              key={item.id}
              onClick={() => onNavigate(item.id)}
              type="button"
            >
              <Icon size={18} strokeWidth={1.8} />
              <span>{item.label}</span>
              {item.id === "activity" && jobCount > 0 ? (
                <span className="nav-count">{jobCount}</span>
              ) : null}
            </button>
          );
        })}
      </nav>

      <div className="sidebar-spacer" />
      <div className="privacy-note">
        <span className="status-dot" />
        <div>
          <strong>Privato per progetto</strong>
          <p>I file restano sul dispositivo.</p>
        </div>
      </div>
    </aside>
  );
}
