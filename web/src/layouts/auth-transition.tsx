

export default function AuthTemplate({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="animate-in fade-in duration-150 motion-reduce:animate-none">
      {children}
    </div>
  )
}
