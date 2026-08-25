import { NavLink, Route, Routes } from "react-router-dom";
import LayoutTool from "@/features/layout/LayoutTool";
import GradientTool from "@/features/gradient/GradientTool";
import { ShortcutsOverlay } from "@/components/ShortcutsOverlay";
import { cn } from "@/lib/utils";

const navItems = [
  { to: "/", label: "レイアウト作成", end: true, testid: "nav-layout" },
  { to: "/gradient", label: "グラデーション作成", end: false, testid: "nav-gradient" },
];

export default function App() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="border-b bg-card">
        <div className="max-w-[1100px] mx-auto px-4 h-12 flex items-center gap-1">
          <span className="text-sm font-bold tracking-tight mr-3">制作画像クリエイター</span>
          <nav className="flex items-center gap-1">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                data-testid={item.testid}
                className={({ isActive }) =>
                  cn(
                    "rounded-md px-3 py-1.5 text-sm transition-colors",
                    isActive
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>
      <main className="flex-1">
        <Routes>
          <Route path="/" element={<LayoutTool />} />
          <Route path="/gradient" element={<GradientTool />} />
        </Routes>
      </main>
      <footer className="py-4 text-center text-xs text-muted-foreground">
        Copyright © エンパワーヘルスケア株式会社 All Rights Reserved.
      </footer>
      <ShortcutsOverlay />
    </div>
  );
}
