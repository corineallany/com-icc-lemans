import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

function urlBase64ToUint8Array(base64String:string):ArrayBuffer{const padding="=".repeat((4-(base64String.length%4))%4);const base64=(base64String+padding).replace(/-/g,"+").replace(/_/g,"/");const rawData=atob(base64);const out=new Uint8Array(rawData.length);for(let i=0;i<rawData.length;i++)out[i]=rawData.charCodeAt(i);return out.buffer.slice(0,out.byteLength) as ArrayBuffer}
export type PushState="unsupported"|"loading"|"default"|"granted"|"denied";
const swUrl=()=>`${import.meta.env.BASE_URL || "/"}sw.js`;
async function callPush(body:Record<string,unknown>){const{data,error}=await supabase.functions.invoke("send-push",{body});if(error)throw new Error(error.message);if(!data?.success)throw new Error(data?.error||"Erreur du service Push");return data}

export function usePush(userId:string|undefined){
 const[state,setState]=useState<PushState>("loading"),[subscribed,setSubscribed]=useState(false),[currentEndpoint,setCurrentEndpoint]=useState<string|null>(null),[error,setError]=useState<string|null>(null);
 useEffect(()=>{if(!userId)return;if(!("serviceWorker" in navigator)||!("PushManager" in window)||!("Notification" in window)){setState("unsupported");return}
  let cancelled=false;
  async function init(){try{await navigator.serviceWorker.register(swUrl());const reg=await navigator.serviceWorker.ready;const perm=Notification.permission;if(cancelled)return;setState(perm==="granted"?"granted":perm==="denied"?"denied":"default");const local=await reg.pushManager.getSubscription();if(cancelled)return;setCurrentEndpoint(local?.endpoint??null);if(perm==="granted"&&local){const remote=await callPush({action:"push-status",endpoint:local.endpoint});if(!cancelled)setSubscribed(!!remote.active)}else if(!cancelled)setSubscribed(false)}catch(err){if(cancelled)return;setState(Notification.permission==="denied"?"denied":"default");setSubscribed(false);setError(err instanceof Error?err.message:"Impossible d’initialiser les notifications push.")}}
  init();return()=>{cancelled=true};
 },[userId]);
 const enable=useCallback(async()=>{if(!userId)return;setError(null);setState("loading");try{
  if(!window.matchMedia("(display-mode: standalone)").matches&&/iPhone|iPad|iPod/i.test(navigator.userAgent)){setState("default");setError("Sur iPhone, ouvrez COM ICC depuis l’icône installée sur l’écran d’accueil, puis réessayez.");return}
  const registration=await navigator.serviceWorker.register(swUrl());await navigator.serviceWorker.ready;
  const perm=await Notification.requestPermission();if(perm!=="granted"){setState(perm==="denied"?"denied":"default");setError("Les notifications n’ont pas été autorisées. Sur iPhone, vérifiez Réglages > Notifications > COM ICC.");return}setState("granted");
  let sub=await registration.pushManager.getSubscription();
  if(!sub){const key=await callPush({action:"public-key"});if(!key.publicKey)throw new Error("La clé Push publique n’est pas configurée.");sub=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:urlBase64ToUint8Array(key.publicKey)})}
  await callPush({action:"push-subscribe",subscription:sub.toJSON(),userAgent:navigator.userAgent});
  const status=await callPush({action:"push-status",endpoint:sub.endpoint});if(!status.active)throw new Error("L’abonnement Push de cet appareil n’a pas été confirmé par le serveur.");
  setCurrentEndpoint(sub.endpoint);setSubscribed(true);
 }catch(err){setState(Notification.permission==="denied"?"denied":"default");setError(err instanceof Error?err.message:"Erreur lors de l’activation des notifications.")}},[userId]);
 const disable=useCallback(async()=>{if(!userId)return;setError(null);try{const reg=await navigator.serviceWorker.ready,sub=await reg.pushManager.getSubscription();if(sub){await callPush({action:"push-disable",endpoint:sub.endpoint});await sub.unsubscribe()}setCurrentEndpoint(null);setSubscribed(false)}catch(err){setError(err instanceof Error?err.message:"Erreur lors de la désactivation")}},[userId]);
 return{state,subscribed,currentEndpoint,error,enable,disable};
}
