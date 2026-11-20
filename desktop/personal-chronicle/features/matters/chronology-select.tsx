import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { cn } from "@/lib/utils"

type Option = { value: string; label: string; disabled?: boolean }

export function ChronologySelect({
  label,
  id,
  items,
  value,
  defaultValue,
  onChange,
  disabled,
  required,
  name,
  placeholder,
  className,
  compact,
}: {
  label: string
  id?: string
  items: Record<string, string> | Option[]
  value?: string | null
  defaultValue?: string
  onChange?(value: string): void
  disabled?: boolean
  required?: boolean
  name?: string
  placeholder?: string
  className?: string
  compact?: boolean
}) {
  const options: Option[] = Array.isArray(items) ? items : Object.entries(items).map(([value, label]) => ({ value, label }))
  return (
    <Select modal={false} items={options} value={value} defaultValue={defaultValue} name={name} required={required} disabled={disabled}
      onValueChange={next => onChange?.(next ?? "")}>
      <SelectTrigger size="sm" id={id} aria-label={label} className={cn("min-w-0 max-w-full", compact && "text-xs", className)}>
        <SelectValue placeholder={placeholder} className="min-w-0 break-all" />
      </SelectTrigger>
      <SelectContent align="start" alignItemWithTrigger={false}>
        <SelectGroup>
          {options.map(option => <SelectItem key={option.value} value={option.value} disabled={option.disabled}
            className={cn("[&>span:first-child]:min-w-0 [&>span:first-child]:whitespace-normal [&>span:first-child]:[overflow-wrap:anywhere]", compact && "text-xs")}>
            {option.label}
          </SelectItem>)}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}
