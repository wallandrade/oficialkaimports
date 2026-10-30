import { useEffect, useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";

type GroupChat = { name: string; phone: string };
type ProductRow = { id: string; name: string; image: string | null; hasHttpsImage: boolean; isSoldOut: boolean };
type ScheduleMode = "once" | "times" | "interval";
type CustomPost = {
  id: string;
  imageUrl: string;
  caption: string;
  linkUrl: string;
  scheduledAt: string;
  scheduleMode: ScheduleMode;
  scheduleTimes: string[];
  intervalHours: number | null;
  durationDays: number | null;
};
type Snapshot = {
  campaignEnabled: boolean;
  chats: GroupChat[];
  productIds: string[];
  products: ProductRow[];
  posts: CustomPost[];
  peptide: { enabled: false };
  zapiConfigured: boolean;
};

const EMPTY_CHATS: GroupChat[] = Array.from({ length: 6 }, () => ({ name: "", phone: "" }));
const fieldClass = "mt-1 block h-10 w-full rounded-xl border-2 border-border px-3";

function authHeaders(): Record<string, string> {
  const token = sessionStorage.getItem("adminToken") || localStorage.getItem("adminToken") || "";
  return token
    ? { "Content-Type": "application/json", Authorization: `Bearer ${token}` }
    : { "Content-Type": "application/json" };
}

function padChats(chats: GroupChat[]): GroupChat[] {
  const next = chats.slice(0, 6).map((chat) => ({ name: chat.name || "", phone: chat.phone || "" }));
  while (next.length < 6) next.push({ name: "", phone: "" });
  return next;
}

function scheduleLabel(post: CustomPost): string {
  if (post.scheduleMode === "times") {
    return `${post.scheduledAt.slice(0, 10)} · ${post.scheduleTimes.join(", ")} · ${post.durationDays || 1} dia(s)`;
  }
  if (post.scheduleMode === "interval") {
    return `${post.scheduledAt.replace("T", " ")} · a cada ${post.intervalHours || 1}h · ${post.durationDays || 1} dia(s)`;
  }
  return post.scheduledAt.replace("T", " ");
}

async function compressImage(file: File): Promise<string> {
  if (file.size > 10 * 1024 * 1024) throw new Error("Arquivo acima de 10 MB.");
  const allowed = ["image/jpeg", "image/png", "image/webp", "image/gif"];
  if (file.type && !allowed.includes(file.type)) throw new Error("Envie JPG, PNG, WebP ou GIF.");
  const dataUrl = await readFile(file);
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Não foi possível ler a imagem."));
    img.src = dataUrl;
  });
  const width = Math.min(1280, image.naturalWidth || image.width || 1280);
  const sourceWidth = image.naturalWidth || image.width || width;
  const sourceHeight = image.naturalHeight || image.height || width;
  const height = Math.max(1, Math.round(sourceHeight * (width / sourceWidth)));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Não foi possível reduzir a imagem.");
  ctx.drawImage(image, 0, 0, width, height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
  if (!blob) throw new Error("Não foi possível reduzir a imagem.");
  return readFile(new File([blob], "foto.jpg", { type: "image/jpeg" }));
}

function readFile(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Não foi possível ler a imagem."));
    reader.readAsDataURL(file);
  });
}

export function WhatsAppGroupCampaignCard() {
  const [campaignEnabled, setCampaignEnabled] = useState(false);
  const [chats, setChats] = useState<GroupChat[]>(EMPTY_CHATS);
  const [productIds, setProductIds] = useState<string[]>([]);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [posts, setPosts] = useState<CustomPost[]>([]);
  const [zapiConfigured, setZapiConfigured] = useState(true);
  const [error, setError] = useState("");
  const [postError, setPostError] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState("");
  const [caption, setCaption] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [scheduleMode, setScheduleMode] = useState<ScheduleMode>("once");
  const [scheduledAt, setScheduledAt] = useState("");
  const [timesDate, setTimesDate] = useState("");
  const [times, setTimes] = useState<string[]>(["09:00"]);
  const [intervalHours, setIntervalHours] = useState("2");
  const [durationDays, setDurationDays] = useState("1");

  async function load() {
    const res = await fetch("/api/admin/whatsapp/groups", { headers: authHeaders() });
    const json = await res.json() as Snapshot & { message?: string };
    if (!res.ok) {
      setError(json.message || "Não foi possível carregar a automação.");
      return;
    }
    setCampaignEnabled(json.campaignEnabled);
    setChats(padChats(json.chats || []));
    setProductIds(json.productIds || []);
    setProducts(json.products || []);
    setPosts(json.posts || []);
    setZapiConfigured(json.zapiConfigured);
    setError("");
  }

  useEffect(() => {
    void load();
  }, []);

  function toggleProduct(id: string) {
    setProductIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  async function saveCampaign() {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/whatsapp/groups", {
        method: "PUT",
        headers: authHeaders(),
        body: JSON.stringify({ campaignEnabled, productIds, chats }),
      });
      const json = await res.json() as Snapshot & { message?: string };
      if (!res.ok) {
        setError(json.message || "Não foi possível salvar.");
        return;
      }
      setCampaignEnabled(json.campaignEnabled);
      setChats(padChats(json.chats || []));
      setProductIds(json.productIds || []);
      setProducts(json.products || []);
      setPosts(json.posts || []);
      setError("");
    } finally {
      setBusy(false);
    }
  }

  function resetPostForm() {
    setEditingId(null);
    setImageUrl("");
    setCaption("");
    setLinkUrl("");
    setScheduleMode("once");
    setScheduledAt("");
    setTimesDate("");
    setTimes(["09:00"]);
    setIntervalHours("2");
    setDurationDays("1");
    setPostError("");
  }

  function editPost(post: CustomPost) {
    setEditingId(post.id);
    setImageUrl(post.imageUrl);
    setCaption(post.caption);
    setLinkUrl(post.linkUrl || "");
    setScheduleMode(post.scheduleMode);
    setScheduledAt(post.scheduleMode === "times" ? "" : post.scheduledAt);
    setTimesDate(post.scheduleMode === "times" ? post.scheduledAt.slice(0, 10) : "");
    setTimes(post.scheduleTimes.length ? post.scheduleTimes : ["09:00"]);
    setIntervalHours(String(post.intervalHours || 2));
    setDurationDays(String(post.durationDays || 1));
    setPostError("");
  }

  async function onPickImage(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    setPostError("");
    try {
      const imageData = await compressImage(file);
      const res = await fetch("/api/admin/whatsapp/groups/upload-image", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ imageData }),
      });
      const json = await res.json() as { imageUrl?: string; message?: string };
      if (!res.ok || !json.imageUrl) {
        setPostError(json.message || "Não foi possível enviar a imagem.");
        return;
      }
      setImageUrl(json.imageUrl);
    } catch (err) {
      setPostError(err instanceof Error ? err.message : "Não foi possível enviar a imagem.");
    } finally {
      setUploading(false);
    }
  }

  async function savePost() {
    setBusy(true);
    setPostError("");
    try {
      const body = {
        imageUrl,
        caption,
        linkUrl,
        scheduleMode,
        scheduledAt: scheduleMode === "times" ? timesDate : scheduledAt,
        scheduleTimes: times,
        intervalHours: Number(intervalHours),
        durationDays: Number(durationDays),
      };
      const res = await fetch(editingId ? `/api/admin/whatsapp/groups/custom/${editingId}` : "/api/admin/whatsapp/groups/custom", {
        method: editingId ? "PUT" : "POST",
        headers: authHeaders(),
        body: JSON.stringify(body),
      });
      const json = await res.json() as { message?: string };
      if (!res.ok) {
        setPostError(json.message || "Não foi possível salvar o aviso.");
        return;
      }
      resetPostForm();
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function deletePost(id: string) {
    if (!window.confirm("Apagar este aviso? O que já foi enviado não é desfeito.")) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/whatsapp/groups/custom/${id}`, { method: "DELETE", headers: authHeaders() });
      const json = await res.json() as { message?: string };
      if (!res.ok) {
        setPostError(json.message || "Não foi possível apagar o aviso.");
        return;
      }
      if (editingId === id) resetPostForm();
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-3xl space-y-6">
      <section className="space-y-4 rounded-2xl border border-border bg-white p-5">
        <div>
          <h2 className="text-lg font-bold">Produtos nos grupos</h2>
          <p className="text-sm text-muted-foreground">
            A foto sai às 9h, 13h, 17h e 21h, no horário de São Paulo. Os grupos recebem o mesmo produto. Sem identificador válido, nada é enviado.
          </p>
        </div>
        {!zapiConfigured ? (
          <p className="text-sm text-amber-700">O envio espera as variáveis da Z-API no servidor. Sem elas, nada sai.</p>
        ) : null}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={campaignEnabled} onChange={(event) => setCampaignEnabled(event.target.checked)} />
          Campanha ligada
        </label>
        <div className="space-y-3">
          {chats.map((chat, index) => (
            <div key={index} className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <label className="text-sm">
                Grupo {index + 1}
                <input
                  value={chat.name}
                  onChange={(event) => setChats((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item))}
                  placeholder="Nome"
                  className={fieldClass}
                />
              </label>
              <label className="text-sm">
                Identificador
                <input
                  value={chat.phone}
                  onChange={(event) => setChats((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, phone: event.target.value } : item))}
                  placeholder="5581...-1608... ou ...-group"
                  className={fieldClass}
                />
              </label>
            </div>
          ))}
        </div>
        <div className="max-h-80 space-y-2 overflow-y-auto rounded-xl border border-border p-3">
          {products.length === 0 ? <p className="text-sm text-muted-foreground">Nenhum produto ativo.</p> : null}
          {products.map((product) => (
            <label key={product.id} className={`flex items-center gap-3 text-sm ${product.hasHttpsImage ? "" : "text-muted-foreground"}`}>
              <input
                type="checkbox"
                checked={productIds.includes(product.id)}
                disabled={!product.hasHttpsImage}
                onChange={() => toggleProduct(product.id)}
              />
              {product.image ? <img src={product.image} alt="" className="h-10 w-10 rounded-lg object-cover" /> : <span className="h-10 w-10 rounded-lg bg-neutral-100" />}
              <span className="min-w-0">
                <span className="block truncate font-medium">{product.name}</span>
                {!product.hasHttpsImage ? <span className="text-xs">Sem foto https</span> : null}
                {product.isSoldOut ? <span className="ml-2 text-xs">Esgotado</span> : null}
              </span>
            </label>
          ))}
        </div>
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <Button type="button" onClick={() => void saveCampaign()} disabled={busy}>Salvar</Button>
      </section>

      <section className="space-y-3 rounded-2xl border border-border bg-white p-5">
        <div>
          <h2 className="text-lg font-bold">Explicação diária</h2>
          <p className="text-sm text-muted-foreground">Fica desligada até as fichas de peptídeo existirem.</p>
        </div>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input type="checkbox" checked={false} disabled />
          Campanha ligada
        </label>
      </section>

      <section className="space-y-4 rounded-2xl border border-border bg-white p-5">
        <div>
          <h2 className="text-lg font-bold">Imagem e link avulso</h2>
          <p className="text-sm text-muted-foreground">
            Uma vez, vários horários no dia, ou de X em X horas. A foto sobe em JPEG, com no máximo 1280 px de largura.
          </p>
        </div>
        {imageUrl ? <img src={imageUrl} alt="" className="h-24 w-24 rounded-xl object-cover" /> : null}
        <label className="block text-sm">
          Foto
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            className="mt-1 block w-full text-sm"
            disabled={uploading || busy}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              void onPickImage(file);
            }}
          />
        </label>
        <label className="block text-sm">
          Texto
          <textarea value={caption} maxLength={1000} rows={4} onChange={(event) => setCaption(event.target.value)} className="mt-1 w-full rounded-xl border-2 border-border px-3 py-2" />
        </label>
        <label className="block text-sm">
          Link https
          <input value={linkUrl} onChange={(event) => setLinkUrl(event.target.value)} placeholder="https://" className={fieldClass} />
        </label>
        <label className="block text-sm">
          Quando enviar
          <select value={scheduleMode} onChange={(event) => setScheduleMode(event.target.value as ScheduleMode)} className={fieldClass}>
            <option value="once">Uma vez</option>
            <option value="times">Vários horários</option>
            <option value="interval">De X em X horas</option>
          </select>
        </label>
        {scheduleMode === "times" ? (
          <label className="block text-sm">
            Data
            <input type="date" value={timesDate} onChange={(event) => setTimesDate(event.target.value)} className={fieldClass} />
          </label>
        ) : (
          <label className="block text-sm">
            Data e hora de São Paulo
            <input type="datetime-local" value={scheduledAt} onChange={(event) => setScheduledAt(event.target.value)} className={fieldClass} />
          </label>
        )}
        {scheduleMode === "times" ? (
          <div className="space-y-2">
            {times.map((time, index) => (
              <div key={index} className="flex items-center gap-2">
                <input
                  type="time"
                  value={time}
                  onChange={(event) => setTimes((current) => current.map((item, itemIndex) => itemIndex === index ? event.target.value : item))}
                  className="h-10 rounded-xl border-2 border-border px-3"
                />
                {times.length > 1 ? (
                  <Button type="button" variant="outline" onClick={() => setTimes((current) => current.filter((_, itemIndex) => itemIndex !== index))}>Tirar</Button>
                ) : null}
              </div>
            ))}
            {times.length < 12 ? (
              <Button type="button" variant="outline" onClick={() => setTimes((current) => [...current, "09:00"])}>Adicionar horário</Button>
            ) : null}
          </div>
        ) : null}
        {scheduleMode === "interval" ? (
          <label className="block text-sm">
            A cada quantas horas
            <input type="number" min={1} max={12} value={intervalHours} onChange={(event) => setIntervalHours(event.target.value)} className="mt-1 block h-10 w-24 rounded-xl border-2 border-border px-3" />
          </label>
        ) : null}
        {scheduleMode !== "once" ? (
          <label className="block text-sm">
            Por quantos dias
            <input type="number" min={1} max={30} value={durationDays} onChange={(event) => setDurationDays(event.target.value)} className="mt-1 block h-10 w-24 rounded-xl border-2 border-border px-3" />
          </label>
        ) : null}
        {postError ? <p className="text-sm text-red-600">{postError}</p> : null}
        <div className="flex gap-2">
          <Button type="button" onClick={() => void savePost()} disabled={busy || uploading}>{editingId ? "Salvar aviso" : "Criar aviso"}</Button>
          {editingId ? <Button type="button" variant="outline" onClick={resetPostForm}>Cancelar</Button> : null}
        </div>
        <ul className="space-y-3">
          {posts.map((post) => (
            <li key={post.id} className="flex items-start gap-3 rounded-xl border border-border p-3">
              <img src={post.imageUrl} alt="" className="h-14 w-14 rounded-lg object-cover" />
              <div className="min-w-0 flex-1">
                <p className="line-clamp-3 text-sm">{post.caption}</p>
                <p className="mt-1 text-xs text-muted-foreground">{scheduleLabel(post)}</p>
              </div>
              <button type="button" className="rounded-lg p-2 text-muted-foreground hover:bg-neutral-100" onClick={() => editPost(post)} aria-label="Editar aviso">
                <Pencil className="h-4 w-4" />
              </button>
              <button type="button" className="rounded-lg p-2 text-muted-foreground hover:bg-neutral-100" onClick={() => void deletePost(post.id)} aria-label="Apagar aviso">
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
