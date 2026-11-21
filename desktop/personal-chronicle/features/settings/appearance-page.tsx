"use client"

import {
  BanIcon,
  CheckIcon,
  LayoutTemplateIcon,
  MonitorIcon,
  MoonIcon,
  PaletteIcon,
  RotateCcwIcon,
  SunIcon,
  TypeIcon,
} from "lucide-react"
import { useTheme } from "next-themes"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { toast } from "@/components/ui/toast"
import { PillBars } from "@/components/chronicle/charts"
import { crossFade } from "@/kit/customizer/cross-fade"
import {
  useCustomizer,
  useKitTheme,
} from "@/kit/customizer/customizer-provider"
import { findPreset } from "@/kit/customizer/presets"
import type { CustomizerSettings } from "@/kit/customizer/settings"
import {
  SettingsCard,
  SettingsHero,
  SettingsSkeleton,
} from "@/kit/settings/section"
import { Segmented } from "@/kit/ui-patterns/segmented"
import { Delta } from "@/kit/widgets/widget"
import { cn } from "@/lib/utils"

import { FIT_HERO, SETTINGS_PAGE } from "./fit-hero"

/**
 * The header customizer at full size: the same settings store, so a change
 * here shows in the header panel and the other way round. Changes apply at
 * once and are saved in this browser, so there is no save bar.
 */

const RADIUS_OPTIONS = [
  { value: "0rem", label: "", icon: BanIcon, ariaLabel: "No radius" },
  { value: "0.375rem", label: "SM" },
  { value: "0.625rem", label: "MD" },
  { value: "0.875rem", label: "LG" },
]

/** A preset's own radius, snapped to the nearest option offered (as the header panel does). */
function nearestRadius(radius: string): string {
  const rem = radius.endsWith("px")
    ? parseFloat(radius) / 16
    : parseFloat(radius)
  return RADIUS_OPTIONS.reduce((best, option) =>
    Math.abs(parseFloat(option.value) - rem) <
    Math.abs(parseFloat(best.value) - rem)
      ? option
      : best
  ).value
}

/** Signups per day for the preview chart: fixed, so the preview never changes on its own. */
const PREVIEW_SERIES = [14, 18, 16, 22, 19, 27, 24].map((value, index) => ({
  label: ["M", "T", "W", "T", "F", "S", "S"][index],
  value,
}))

function Row({
  label,
  description,
  children,
}: {
  label: string
  description?: string
  children: React.ReactNode
}) {
  return (
    // Label and control share a line only when the card leaves the label room (576px), not by screen width: beside the sidebar and the settings menu a 1024px screen leaves under 500px.
    <div className="@container/row border-b py-4 first:pt-0 last:border-b-0 last:pb-0">
      <div className="flex flex-col gap-2 @xl/row:flex-row @xl/row:items-center @xl/row:justify-between @xl/row:gap-6">
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-medium">{label}</span>
          {description && (
            <span className="text-sm text-muted-foreground">
              {description}
            </span>
          )}
        </div>
        <div className="w-full shrink-0 @xl/row:w-80">{children}</div>
      </div>
    </div>
  )
}

/** A small slice of the app in the current theme, so a change reads before you leave the page. */
function LivePreview({ workbench }: { workbench: boolean }) {
  return (
    <div className="flex flex-col gap-2" aria-label={workbench ? "实时预览" : "Live preview"}>
      <span className="text-sm text-muted-foreground">{workbench ? "实时预览" : "Live preview"}</span>
      <div className="flex overflow-hidden rounded-xl bg-page shadow-(--surface-shadow) ring-1 ring-foreground/5">
        <div
          className="hidden w-28 shrink-0 flex-col gap-1.5 border-e bg-sidebar p-2.5 sm:flex"
          aria-hidden
        >
          <span className="mb-1 h-2 w-14 rounded-full bg-sidebar-foreground/30" />
          <span className="flex h-6 items-center rounded-md bg-sidebar-accent px-2">
            <span className="h-1.5 w-12 rounded-full bg-sidebar-primary" />
          </span>
          {[16, 12, 14, 10].map((width, index) => (
            <span key={index} className="flex h-6 items-center px-2">
              <span
                className="h-1.5 rounded-full bg-sidebar-foreground/20"
                style={{ width: width * 4 }}
              />
            </span>
          ))}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-2.5 p-3">
          <div className="flex flex-col gap-3 rounded-lg bg-card p-3 shadow-(--surface-shadow)">
            <div className="flex items-start justify-between gap-2">
              <div className="flex flex-col gap-0.5">
                <span className="text-xs text-muted-foreground">
                  {workbench ? "示例统计" : "New signups"}
                </span>
                <span className="flex items-baseline gap-2">
                  <span className="font-mono text-2xl font-semibold tracking-tight tabular-nums">
                    140
                  </span>
                  <Delta value={0.124} className="text-xs" />
                </span>
              </div>
              <Badge variant="secondary">{workbench ? "7 天" : "7 days"}</Badge>
            </div>
            <PillBars
              data={PREVIEW_SERIES}
              highlight="last"
              barSize={14}
              className="h-20"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm">{workbench ? "主按钮" : "Primary"}</Button>
            <Button size="sm" variant="outline">
              {workbench ? "次按钮" : "Outline"}
            </Button>
            <Switch
              defaultChecked
              aria-label={workbench ? "预览开关" : "Preview switch"}
              className="ms-auto"
            />
          </div>
        </div>
      </div>
    </div>
  )
}

export function AppearanceSettingsPage({ workbench = false }: { workbench?: boolean }) {
  const settings = useCustomizer((state) => state)
  const { presets, fonts } = useKitTheme()
  const { theme, resolvedTheme, setTheme } = useTheme()
  const set = (patch: Partial<CustomizerSettings>) => settings.set(patch)
  const current = settings.custom ? null : findPreset(presets, settings.preset)
  const fontItems = fonts.map((font) => ({ value: font.id, label: font.label }))
  const mode = (theme ?? "system") as "light" | "dark" | "system"

  // Saved settings and the colour mode are read in the browser, so wait for them rather than flash the defaults.
  if (!settings.hydrated) {
    return <SettingsSkeleton />
  }

  return (
    <div className={SETTINGS_PAGE}>
      <SettingsHero aside={<LivePreview workbench={workbench} />} className={FIT_HERO}>
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm text-muted-foreground">{workbench ? "当前外观" : "Current look"}</span>
          <Button
            variant="ghost"
            size="sm"
            className="-me-2 text-muted-foreground"
            onClick={() => {
              crossFade(() => {
                settings.reset()
                setTheme("light")
              })
              toast.add({
                type: "success",
                title: workbench ? "已重置外观" : "Appearance reset",
                description: workbench ? "已恢复默认外观。" : "Back to Chronicle's defaults.",
              })
            }}
          >
            <RotateCcwIcon data-icon="inline-start" />
            {workbench ? "重置" : "Reset"}
          </Button>
        </div>
        <div className="flex flex-col gap-1">
          <span className="font-heading text-2xl font-semibold tracking-tight">
            {current?.name ?? (workbench ? "导入的主题" : "Imported theme")}
          </span>
          <span className="text-sm text-muted-foreground">
            {workbench
              ? (resolvedTheme === "dark" ? "深色" : "浅色") + (mode === "system" ? "（跟随系统）" : "")
              : (resolvedTheme === "dark" ? "Dark" : "Light") + " mode" + (mode === "system" ? " (from your system)" : "")} ·{" "}
            {fonts.find((font) => font.id === settings.font)?.label} ·{" "}
            {settings.layout === "top" ? (workbench ? "顶栏" : "top bar") : (workbench ? "侧栏" : "sidebar")}
          </span>
        </div>
        {current && (
          <div
            className="flex h-8 overflow-hidden rounded-lg ring-1 ring-foreground/10"
            aria-hidden
          >
            {current.swatches.map((color, index) => (
              // The preset's own colours: data, not styling.
              <span
                key={index}
                className="flex-1"
                style={{ backgroundColor: color }}
              />
            ))}
          </div>
        )}
        <p className="mt-auto text-sm text-muted-foreground">
          {workbench ? "调整会立即生效并保存在当前浏览器。" : "The same settings as the palette button in the header. Saved in this browser."}
        </p>
      </SettingsHero>

      <SettingsCard
        icon={PaletteIcon}
        title={workbench ? "主题" : "Theme"}
        description={workbench ? "设置工作台的配色和圆角。" : "Colours for every surface, chart and status. Each theme brings its own corner radius."}
      >
        <div className="@container/presets flex flex-col gap-5">
          {/* Nine presets: a list on phones, then always three across (stacked tiles while narrow), so no row is left with one. */}
          <div
            className="grid gap-2 @sm/presets:grid-cols-3"
            role="radiogroup"
            aria-label={workbench ? "主题预设" : "Theme preset"}
          >
            {presets.map((preset) => {
              const selected = !settings.custom && preset.id === settings.preset
              return (
                <button
                  key={preset.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() =>
                    crossFade(() =>
                      set({
                        preset: preset.id,
                        custom: null,
                        radius: nearestRadius(preset.radius),
                      })
                    )
                  }
                  className={cn(
                    "group/preset relative flex items-center gap-3 rounded-xl @sm/presets:flex-col @sm/presets:items-stretch @sm/presets:gap-2 @3xl/presets:flex-row @3xl/presets:items-center @3xl/presets:gap-3 bg-muted/40 p-2.5 text-start ring-1 ring-transparent transition-[background-color,box-shadow] duration-150 outline-none hover:bg-muted/70 focus-visible:ring-3 focus-visible:ring-ring/50",
                    selected &&
                      "bg-card shadow-(--surface-shadow) ring-2 ring-primary hover:bg-card"
                  )}
                >
                  <span
                    className="flex h-9 w-16 shrink-0 overflow-hidden rounded-md ring-1 ring-foreground/10 @sm/presets:h-8 @sm/presets:w-full @3xl/presets:h-9 @3xl/presets:w-16"
                    aria-hidden
                  >
                    {preset.swatches.map((color, index) => (
                      <span
                        key={index}
                        className="flex-1"
                        style={{ backgroundColor: color }}
                      />
                    ))}
                  </span>
                  <span className="flex min-w-0 flex-1 items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">
                      {preset.name}
                    </span>
                    <span
                      className={cn(
                        // Stacked tiles carry the tick on the swatch, so the name keeps the full width.
                        "flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground ring-2 ring-card transition-[opacity,scale] duration-150 @sm/presets:absolute @sm/presets:end-4 @sm/presets:top-4.5 @3xl/presets:static @3xl/presets:ring-0",
                        selected ? "scale-100 opacity-100" : "scale-75 opacity-0"
                      )}
                    >
                      <CheckIcon className="size-3" strokeWidth={3} />
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
          <div className="flex flex-col border-t pt-4">
            <Row
              label={workbench ? "颜色模式" : "Color mode"}
              description={workbench ? "跟随系统会使用设备的浅色或深色模式。" : "System follows the setting on your device."}
            >
              <Segmented
                aria-label={workbench ? "颜色模式" : "Color mode"}
                size="default"
                value={mode}
                onChange={(next) => crossFade(() => setTheme(next))}
                options={[
                  { value: "light", label: workbench ? "浅色" : "Light", icon: SunIcon },
                  { value: "dark", label: workbench ? "深色" : "Dark", icon: MoonIcon },
                  { value: "system", label: workbench ? "跟随系统" : "System", icon: MonitorIcon },
                ]}
              />
            </Row>
            <Row label={workbench ? "圆角" : "Corner radius"} description={workbench ? "应用于卡片、按钮和输入框。" : "Cards, buttons and inputs."}>
              <Segmented
                aria-label={workbench ? "圆角" : "Corner radius"}
                size="default"
                value={settings.radius}
                onChange={(radius) => set({ radius })}
                options={RADIUS_OPTIONS}
              />
            </Row>
          </div>
        </div>
      </SettingsCard>

      <SettingsCard
        icon={TypeIcon}
        tone="two"
        title={workbench ? "文字" : "Text"}
        description={workbench ? "调整字体与界面缩放。" : "Typeface and how large everything is drawn."}
      >
        <FieldGroup className="gap-0">
          <Row
            label={workbench ? "字体" : "Font"}
            description={workbench ? "等宽数字沿用原字体。" : "Numbers always use the monospace face."}
          >
            <Field>
              <FieldLabel htmlFor="appearance-font" className="sr-only">
                {workbench ? "字体" : "Font"}
              </FieldLabel>
              <Select
                items={fontItems}
                value={settings.font}
                onValueChange={(value) =>
                  value && set({ font: value as CustomizerSettings["font"] })
                }
              >
                <SelectTrigger id="appearance-font" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {fontItems.map((font) => (
                      <SelectItem key={font.value} value={font.value}>
                        {font.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
          </Row>
          <Row
            label={workbench ? "缩放" : "Scale"}
            description={workbench ? "调整界面的文字和内容大小。" : "Small fits more on a laptop; large is easier to read."}
          >
            <Segmented
              aria-label={workbench ? "缩放" : "Scale"}
              size="default"
              value={settings.scale}
              onChange={(scale) => set({ scale })}
              options={[
                { value: "sm", label: workbench ? "小" : "Small" },
                { value: "md", label: workbench ? "中" : "Medium" },
                { value: "lg", label: workbench ? "大" : "Large" },
              ]}
            />
          </Row>
        </FieldGroup>
      </SettingsCard>

      <SettingsCard
        icon={LayoutTemplateIcon}
        tone="three"
        title={workbench ? "布局" : "Layout"}
        description={workbench ? "调整导航位置和正文宽度。" : "Where the navigation sits and how wide pages run."}
      >
        <div className="flex flex-col">
          <Row label={workbench ? "导航" : "Navigation"}>
            <Segmented
              aria-label={workbench ? "导航" : "Navigation"}
              size="default"
              value={settings.layout}
              onChange={(layout) => set({ layout })}
              options={[
                { value: "sidebar", label: workbench ? "侧栏" : "Sidebar" },
                { value: "top", label: workbench ? "顶栏" : "Top bar" },
              ]}
            />
          </Row>
          {settings.layout === "sidebar" && (
            <>
              <Row label={workbench ? "侧栏样式" : "Sidebar style"}>
                <Segmented
                  aria-label={workbench ? "侧栏样式" : "Sidebar style"}
                  size="default"
                  value={settings.sidebarVariant}
                  onChange={(sidebarVariant) => set({ sidebarVariant })}
                  options={[
                    { value: "sidebar", label: workbench ? "默认" : "Default" },
                    { value: "inset", label: workbench ? "嵌入" : "Inset" },
                    { value: "floating", label: workbench ? "悬浮" : "Floating" },
                  ]}
                />
              </Row>
              <Row
                label={workbench ? "折叠侧栏" : "Collapsed sidebar"}
                description={workbench ? "设置侧栏折叠后保留的内容。" : "What ⌘B leaves on screen."}
              >
                <Segmented
                  aria-label={workbench ? "折叠侧栏" : "Collapsed sidebar"}
                  size="default"
                  value={settings.sidebarCollapsible}
                  onChange={(sidebarCollapsible) => set({ sidebarCollapsible })}
                  options={[
                    { value: "icon", label: workbench ? "图标" : "Icons" },
                    { value: "offcanvas", label: workbench ? "隐藏" : "Hidden" },
                  ]}
                />
              </Row>
            </>
          )}
          <Row
            label={workbench ? "正文宽度" : "Content width"}
            description={workbench ? "在宽屏上限制正文的最大宽度。" : "Compact centres pages on very wide screens."}
          >
            <Segmented
              aria-label={workbench ? "正文宽度" : "Content width"}
              size="default"
              value={settings.contentWidth}
              onChange={(contentWidth) => set({ contentWidth })}
              options={[
                { value: "contained", label: workbench ? "紧凑" : "Compact" },
                { value: "full", label: workbench ? "全宽" : "Full width" },
              ]}
            />
          </Row>
          <Row
            label={workbench ? "从右到左" : "Right to left"}
            description={workbench ? "将界面布局改为从右到左。" : "Mirrors the layout for Arabic, Hebrew and Persian."}
          >
            <Field orientation="horizontal" className="justify-end">
              <FieldDescription className="sr-only">
                {workbench ? "镜像布局" : "Mirror the layout"}
              </FieldDescription>
              <Switch
                aria-label={workbench ? "从右到左" : "Right to left"}
                checked={settings.direction === "rtl"}
                onCheckedChange={(checked) =>
                  set({ direction: checked ? "rtl" : "ltr" })
                }
              />
            </Field>
          </Row>
        </div>
      </SettingsCard>
    </div>
  )
}
