
import { useMemo } from "react"
import { Tag } from "lucide-react"

import { CreatableCombobox } from "@/components/ui/creatable-combobox"

interface ServerTagComboboxProps {
  id?: string
  value: string
  placeholder: string
  selectedTags: string[]
  availableTags: string[]
  createLabel: (tag: string) => string
  onValueChange: (value: string) => void
  onAddTag: (tag: string) => void
}

export function ServerTagCombobox({
  id,
  value,
  placeholder,
  selectedTags,
  availableTags,
  createLabel,
  onValueChange,
  onAddTag,
}: ServerTagComboboxProps) {
  const normalizedSelectedTags = useMemo(
    () => new Set(selectedTags.map((tag) => tag.trim().toLowerCase()).filter(Boolean)),
    [selectedTags]
  )

  const options = useMemo(() => {
    const seen = new Set<string>()

    return availableTags
      .map((tag) => tag.trim())
      .filter(Boolean)
      .filter((tag) => {
        const normalizedTag = tag.toLowerCase()
        if (seen.has(normalizedTag) || normalizedSelectedTags.has(normalizedTag)) {
          return false
        }
        seen.add(normalizedTag)
        return true
      })
      .map((tag) => ({
        value: tag,
        label: tag,
        icon: <Tag className="h-3.5 w-3.5 text-muted-foreground" />,
      }))
  }, [availableTags, normalizedSelectedTags])

  const commitTag = (tag: string) => {
    const normalizedTag = tag.trim()
    if (!normalizedTag) return

    onAddTag(normalizedTag)
    onValueChange("")
  }

  return (
    <CreatableCombobox
      id={id}
      value={value}
      onValueChange={onValueChange}
      options={options}
      onSelect={commitTag}
      placeholder={placeholder}
      createLabel={createLabel}
      leadingIcon={<Tag className="h-4 w-4" />}
    />
  )
}
