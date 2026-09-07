import { createFileRoute } from "@tanstack/react-router";
import { Component, type ErrorInfo, type ReactNode, useEffect, useState } from "react";
import { IccHeader } from "@/components/IccHeader";
import { HomeHero } from "@/components/home/HomeHero";
import { HomeMenuGrid } from "@/components/home/HomeMenuGrid";
import { HomeDashboard } from "@/components/home/HomeDashboard";
import { OrganizationDashboard } from "@/components/home/OrganizationDashboard";
import { TeamLifePanel } from "@/components/home/TeamLifePanel";
import { PERIOD_LABELS, type DashboardPeriod } from "@/lib/period";

export const Route=createFileRoute("/_authenticated/tableau-de-bord")({head:()=>({meta:[{title:"Accueil — COM ICC Le Mans"},{name:"description",content:"Accueil du pôle Communication ICC Le Mans : versets, accès aux modules, tableaux de bord et vie d’équipe."},{property:"og:title",content:"Accueil — COM ICC Le Mans"},{property:"og:type",content:"website"}]}),component:Home});

function readPeriod():DashboardPeriod{
  if(typeof window==="undefined")return"month";
  try{
    const saved=window.localStorage.getItem("icc-dashboard-period") as DashboardPeriod|null;
    return saved&&Object.keys(PERIOD_LABELS).includes(saved)?saved:"month";
  }catch{
    return"month";
  }
}

class SafeBlock extends Component<{children:ReactNode},{failed:boolean}>{
  state={failed:false};
  static getDerivedStateFromError(){return{failed:true};}
  componentDidCatch(error:unknown,info:ErrorInfo){console.error("Dashboard block failed",error,info);}
  render(){return this.state.failed?null:this.props.children;}
}

function Home(){
  const[period,setPeriod]=useState<DashboardPeriod>(readPeriod);
  useEffect(()=>{
    const sync=()=>setPeriod(readPeriod());
    window.addEventListener("storage",sync);
    window.addEventListener("icc-dashboard-period-change",sync);
    return()=>{window.removeEventListener("storage",sync);window.removeEventListener("icc-dashboard-period-change",sync)};
  },[]);
  return <div className="min-h-screen bg-background text-foreground">
    <SafeBlock><IccHeader/></SafeBlock>
    <main className="mx-auto max-w-7xl px-4 py-6">
      <SafeBlock><HomeHero/></SafeBlock>
      <SafeBlock><HomeMenuGrid/></SafeBlock>
      <SafeBlock><HomeDashboard period={period}/></SafeBlock>
      <SafeBlock><OrganizationDashboard period={period}/></SafeBlock>
      <SafeBlock><TeamLifePanel/></SafeBlock>
    </main>
  </div>
}
