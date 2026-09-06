import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { programError } from "@/lib/program-errors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function PersonalProfileEditor({ member, userId }: { member: any; userId: string }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<any>({});
  const [photo, setPhoto] = useState<File | null>(null);
  const fields = [['first_name','Prénom'], ['last_name','Nom'], ['arrival_month','Mois d’arrivée'], ['arrival_year','Année d’arrivée'], ['birthday_day','Jour de naissance'], ['birthday_month','Mois de naissance'], ['affiliations','Affiliations']] as const;
  const begin = () => { setDraft(Object.fromEntries([...fields.map(([key]) => [key, member[key] ?? '']), ['photo_url', member.photo_url ?? ''], ['is_ejp', !!member.is_ejp], ['is_icc', !!member.is_icc]])); setPhoto(null); setEditing(true); };
  const save = useMutation({ mutationFn: async () => {
    if (!`${draft.first_name} ${draft.last_name}`.trim()) throw new Error('Renseignez votre nom.');
    const data = { ...draft };
    if (photo) {
      if (!['image/jpeg','image/png','image/webp'].includes(photo.type) || photo.size > 5 * 1024 * 1024) throw new Error('Choisissez une photo JPG, PNG ou WebP de moins de 5 Mo.');
      const path = `self/${userId}/${crypto.randomUUID()}.${photo.type.split('/')[1]}`;
      const upload = await supabase.storage.from('member-photos').upload(path, photo, { upsert: false });
      if (upload.error) throw upload.error;
      data.photo_url = supabase.storage.from('member-photos').getPublicUrl(path).data.publicUrl;
      setDraft((d: any) => ({ ...d, photo_url: data.photo_url })); setPhoto(null);
    }
    const result = await (supabase as any).rpc('update_my_member_profile', { p_data: data });
    if (result.error) throw result.error;
  }, onSuccess: () => { qc.invalidateQueries(); setEditing(false); toast.success('Votre fiche a été mise à jour.'); }, onError: (e) => toast.error(programError(e)) });
  return <Card className="mt-4"><CardHeader><CardTitle className="text-base">Mes informations personnelles</CardTitle></CardHeader><CardContent>
    {!editing ? <Button onClick={begin}>Modifier ma fiche</Button> : <form className="grid gap-4 sm:grid-cols-2" onSubmit={e => { e.preventDefault(); save.mutate(); }}>
      <fieldset disabled={save.isPending} className="contents">
        {fields.map(([key,label]) => <label key={key} className="space-y-1 text-sm">{label}<Input value={draft[key]} type={/month|year|day/.test(key) ? 'number' : 'text'} min={/month|day/.test(key) ? 1 : undefined} max={key.endsWith('month') ? 12 : key === 'birthday_day' ? 31 : undefined} onChange={e => setDraft({ ...draft, [key]: e.target.value })} /></label>)}
        <label className="space-y-1 text-sm">Adresse e-mail<Input value={member.login_email ?? ''} disabled /><span className="text-xs text-muted-foreground">L’adresse de connexion ne peut pas être modifiée ici.</span></label>
        <label className="space-y-1 text-sm">Photo<Input type="file" accept="image/jpeg,image/png,image/webp" onChange={e => setPhoto(e.target.files?.[0] ?? null)} /><span className="text-xs text-muted-foreground">JPG, PNG ou WebP · 5 Mo maximum</span></label>
        <div className="flex gap-4">{[['is_ejp','EJP'],['is_icc','ICC']].map(([key,label]) => <label key={key} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft[key]} onChange={e => setDraft({ ...draft, [key]: e.target.checked })} />{label}</label>)}</div>
        <div className="flex gap-2 sm:col-span-2"><Button type="submit">{save.isPending ? 'Enregistrement…' : 'Enregistrer ma fiche'}</Button><Button type="button" variant="outline" onClick={() => setEditing(false)}>Annuler</Button></div>
      </fieldset>
    </form>}
  </CardContent></Card>;
}
