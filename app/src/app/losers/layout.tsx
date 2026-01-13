export default function LosersLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="h-[calc(100vh-4rem)] flex flex-col">
      {children}
    </div>
  );
}
