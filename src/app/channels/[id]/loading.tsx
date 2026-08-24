export default function ChannelLoading() {
  return (
    <div className="min-h-screen bg-black flex items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <div className="w-12 h-12 border-2 border-red-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-gray-400 text-sm">Memuatkan saluran...</p>
      </div>
    </div>
  );
}
