export default function AdminLoading() {
  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <div className="w-12 h-12 border-2 border-red-500 border-t-transparent rounded-full animate-spin" />
      </div>
    </div>
  );
}
