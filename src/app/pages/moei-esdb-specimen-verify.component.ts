import {CommonModule} from '@angular/common';
import {Component,OnInit} from '@angular/core';
import {HttpClient,HttpErrorResponse} from '@angular/common/http';
import {ActivatedRoute} from '@angular/router';
import {LanguageService} from '../services/language.service';

interface EsdbSpecimenResult {
  mode:'CONTRACT_SANDBOX';
  specimen:true;
  officialVerification:false;
  result:'MATCHED_SANDBOX_SPECIMEN';
  reference:string;
  number:string;
  issuedAt:string;
  expiryDate:string;
  documentStatus:'SIMULATED';
}

/* PUBLIC sample view: no session and no personal identity data exposed. */
@Component({
  selector:'app-moei-esdb-specimen-verify',
  standalone:true,
  imports:[CommonModule],
  templateUrl:'./moei-esdb-specimen-verify.component.html',
  styleUrl:'./moei-esdb-specimen-verify.component.css'
})
export class MoeiEsdbSpecimenVerifyComponent implements OnInit {
  loading=true;
  matched:EsdbSpecimenResult|null=null;
  unavailable=false;
  constructor(private route:ActivatedRoute,private http:HttpClient,public lang:LanguageService){}
  t(en:string,ar:string):string{return this.lang.pick(en,ar);}
  ngOnInit():void{
    const reference=this.route.snapshot.paramMap.get('reference')||'';
    const number=this.route.snapshot.queryParamMap.get('number')||'';
    if(!/^VERIFY-SANDBOX-[a-f0-9]{8}$/.test(reference)||
       !/^SDB-SANDBOX-[a-f0-9]{8}-[a-f0-9]$/.test(number)){
      this.loading=false;return;
    }
    this.http.get<EsdbSpecimenResult>('/api/seafarers/v1/public/esdb/verify',{
      params:{reference,number}
    }).subscribe({
      next:r=>{
        this.matched=r.result==='MATCHED_SANDBOX_SPECIMEN'&&
          r.specimen===true&&r.officialVerification===false?r:null;
        this.loading=false;
      },
      error:(e:HttpErrorResponse)=>{
        this.loading=false;this.matched=null;this.unavailable=e.status!==404;
      }
    });
  }
}
