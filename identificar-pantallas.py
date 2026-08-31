"""Muestra un cartel gigante en cada monitor con el numero que usa
KICK_VIDEO_MONITOR (el mismo orden que EnumDisplayMonitors, 1-based).
Sirve para saber cual es la pantalla 1, la 2, etc."""
import ctypes
import ctypes.wintypes as wt
import tkinter as tk

try:
    ctypes.windll.user32.SetProcessDPIAware()
except Exception:
    pass

mons = []
PROC = ctypes.WINFUNCTYPE(ctypes.c_int, ctypes.c_ulong, ctypes.c_ulong,
                          ctypes.POINTER(wt.RECT), ctypes.c_double)


def _cb(h, hdc, lprc, data):
    r = lprc.contents
    mons.append((r.left, r.top, r.right - r.left, r.bottom - r.top))
    return 1


ctypes.windll.user32.EnumDisplayMonitors(0, 0, PROC(_cb), 0)

root = tk.Tk()
root.withdraw()
COLORS = ["#0b84ff", "#ff2d55", "#34c759", "#ff9500", "#af52de"]

for i, (x, y, w, h) in enumerate(mons, start=1):
    win = tk.Toplevel(root)
    win.overrideredirect(True)
    win.geometry(f"{w}x{h}+{x}+{y}")
    win.configure(bg=COLORS[(i - 1) % len(COLORS)])
    win.attributes("-topmost", True)
    tk.Label(
        win,
        text=f"PANTALLA {i}\n{w}x{h}\n({x},{y})\n\nclic para cerrar",
        font=("Segoe UI", 60, "bold"),
        fg="white",
        bg=COLORS[(i - 1) % len(COLORS)],
        justify="center",
    ).pack(expand=True)
    win.bind("<Button-1>", lambda e: root.destroy())
    win.bind("<Key>", lambda e: root.destroy())

root.after(6000, root.destroy)
root.mainloop()

print("Monitores detectados (orden = KICK_VIDEO_MONITOR):")
for i, (x, y, w, h) in enumerate(mons, start=1):
    print(f"  pantalla {i}: {w}x{h} en ({x},{y})")
